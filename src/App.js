import React, { useState, useEffect, useRef, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, onValue, off, update } from 'firebase/database';
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from 'firebase/auth';

// Firebase Configuration
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  databaseURL: "https://rc-car-74710-default-rtdb.asia-southeast1.firebasedatabase.app/",
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
};

// Validate Firebase config
if (!firebaseConfig.apiKey || !firebaseConfig.databaseURL || !firebaseConfig.projectId) {
  console.warn("Firebase configuration is incomplete. Check your environment variables.");
}

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const database = getDatabase(app);
const auth = getAuth(app); // Get the authentication instance

// Control Modes
const CONTROL_MODE = {
  JOYSTICK: 'JOYSTICK',
  ARROWS: 'ARROWS'
};

// Camera Stream URLs
const BASE_CAMERA_STREAM_URL = "http://rccarcam.local:81/stream";
const MOBILE_CAMERA_STREAM_URL = "http://rccarcam.local:81/stream";

// Google Maps API Key - Note: This key appears to be a placeholder or publicly exposed. Be cautious with API keys.
const MAPS_API_KEY = "AIzaSyCzEccIZNFiLG8VnIp-btN5IYXZkZkb7Kc";

function App() {
  // Authentication States
  const [user, setUser] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false); // To handle login button loading state


  // Control States
  const [mode, setMode] = useState(CONTROL_MODE.ARROWS);
  const [currentDirection, setCurrentDirection] = useState("CENTER");
  const [speed, setSpeed] = useState(1);
  const [sprayLeftActive, setSprayLeftActive] = useState(false);
  const [sprayRightActive, setSprayRightActive] = useState(false);

  // Camera Stream States
  const [videoStreamError, setVideoStreamError] = useState(false);
  const [cctvStream, setCctvStream] = useState(""); // Current URL being loaded in iframe
  const [lastGoodStreamUrl, setLastGoodStreamUrl] = useState(""); // To store the last successfully loaded stream URL
  const iframeRef = useRef(null);

  // Joystick Refs and States
  const joystickContainerRef = useRef(null);
  const joystickKnobRef = useRef(null);
  const [joystickPos, setJoystickPos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  // Sensor Data States
  const [accelerometerData, setAccelerometerData] = useState({ x: 'N/A', y: 'N/A', z: 'N/A' });
  const [ultrasonicDistance, setUltrasonicDistance] = useState('N/A');
  const [gpsLocation, setGpsLocation] = useState({
    latitude: 'N/A',
    longitude: 'N/A',
    geolat: 'N/A',
    geolong: 'N/A'
  });
  const [motionStatus, setMotionStatus] = useState('N/A');
  const [gpsSource, setGpsSource] = useState('NEO6');

  // Map Refs
  const mapRef = useRef(null);
  const googleMap = useRef(null);
  const googleMarker = useRef(null);

  // Constants
  const joystickRadius = 70;
  const deadZoneRadius = 20;
  const axisPriorityThreshold = 0.5;
  // Determines if the user agent is a mobile device for conditional touch handling
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

  // --- AUTHENTICATION LOGIC ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoadingAuth(false);
    });
    return () => unsubscribe(); // Cleanup subscription
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    setLoggingIn(true);

    try {
      await signInWithEmailAndPassword(auth, loginEmail, loginPassword);
      // User successfully logged in. onAuthStateChanged will update 'user' state.
    } catch (err) {
      console.error("Login error:", err.code, err.message);
      switch (err.code) {
        case 'auth/invalid-credential':
        case 'auth/user-not-found':
        case 'auth/wrong-password':
          setLoginError('Invalid email or password. Please try again.');
          break;
        case 'auth/invalid-email':
          setLoginError('Please enter a valid email address.');
          break;
        case 'auth/too-many-requests':
          setLoginError('Access to this account has been temporarily disabled due to many failed login attempts. Please try again later.');
          break;
        default:
          setLoginError('Failed to login. Please check your credentials.');
          break;
      }
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };
  // --- END AUTHENTICATION LOGIC ---

  useEffect(() => {
    if (!database) return;

    const speedRef = ref(database, 'speed');

    // Fetch initial speed value
    onValue(speedRef, (snapshot) => {
      const value = snapshot.val();
      if (value !== null && !isNaN(value)) {
        setSpeed(parseInt(value, 10)); // Update local state
      }
    });

    return () => off(speedRef);
  }, [database]);

  const updateFirebase = useCallback(async (dir, sLeftActive, sRightActive) => {
    if (!database) {
      console.warn("Firebase Realtime DB not initialized for update.");
      return;
    }

    try {
      const dbRef = ref(database, "/");
      await update(dbRef, {
        up: dir === "UP" ? "1" : "0",
        down: dir === "DOWN" ? "1" : "0",
        left: dir === "LEFTY" ? "1" : "0",
        right: dir === "RIGHTY" ? "1" : "0",
        spray_left: sLeftActive ? "1" : "0",
        spray_right: sRightActive ? "1" : "0",
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      console.error("Error updating Realtime Database: ", e);
    }
  }, []);

  useEffect(() => {
    // Only send commands to Firebase if a user is logged in
    if (user) {
      updateFirebase(currentDirection, sprayLeftActive, sprayRightActive);
    }
  }, [currentDirection, sprayLeftActive, sprayRightActive, updateFirebase, user]); // Added user to dependencies

  // Camera Stream Management
  useEffect(() => {
    // Only attempt camera stream connection if user is logged in
    if (!user) {
      setCctvStream(""); // Clear stream if not logged in
      setVideoStreamError(false); // Reset error state
      setLastGoodStreamUrl("");
      return;
    }

    const streamSource = isMobile ? MOBILE_CAMERA_STREAM_URL : BASE_CAMERA_STREAM_URL; // CORRECTED LINE

    const testStreamConnection = async () => {
      const timestampedUrl = `${streamSource}?timestamp=${Date.now()}`;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000); // 3-second timeout

        await fetch(timestampedUrl, {
          method: 'HEAD',
          mode: 'no-cors',
          signal: controller.signal // Abort signal
        });
        clearTimeout(timeoutId);

        setVideoStreamError(false);
        setCctvStream(timestampedUrl);
        setLastGoodStreamUrl(timestampedUrl); // Update last good URL
      } catch (error) {
        setVideoStreamError(true);
        if (lastGoodStreamUrl) {
          setCctvStream(lastGoodStreamUrl); // Keep showing last good frame
        } else {
          setCctvStream(""); // Ensure no broken iframe is loaded if no good URL ever existed
        }
      }
    };

    // Initial load
    testStreamConnection();

    // Set up periodic refresh
    const refreshInterval = setInterval(testStreamConnection, 5000);

    // Handle visibility changes
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        testStreamConnection();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(refreshInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isMobile, lastGoodStreamUrl, user]); // Added user to dependencies

  // Manual camera reconnect
  const handleManualReconnect = useCallback(() => {
    if (!user) return; // Only reconnect if logged in
    setVideoStreamError(false); // Optimistically assume it will reconnect
    const streamSource = isMobile ? MOBILE_CAMERA_STREAM_URL : BASE_CAMERA_STREAM_URL; // CORRECTED LINE
    const timestampedUrl = `${streamSource}?timestamp=${Date.now()}`;
    setCctvStream(timestampedUrl); // Attempt to load the new stream
  }, [isMobile, user]); // Added user to dependencies

  // Sensor Data Listener
  useEffect(() => {
    // Only listen to sensor data if user is logged in
    if (!database || !user) {
      // Clear sensor data if not logged in
      setAccelerometerData({ x: 'N/A', y: 'N/A', z: 'N/A' });
      setUltrasonicDistance('N/A');
      setMotionStatus('N/A');
      setGpsLocation({ latitude: 'N/A', longitude: 'N/A', geolat: 'N/A', geolong: 'N/A' });
      return;
    }

    const rootDataRef = ref(database, '/');
    const unsubscribeRootData = onValue(rootDataRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setAccelerometerData({
          x: data.accel_x !== undefined ? data.accel_x.toFixed(2) : 'N/A',
          y: data.accel_y !== undefined ? data.accel_y.toFixed(2) : 'N/A',
          z: data.accel_z !== undefined ? data.accel_z.toFixed(2) : 'N/A'
        });
        setUltrasonicDistance(data.distance_cm !== undefined ? data.distance_cm.toFixed(2) : 'N/A');
        setMotionStatus(data.motion !== undefined ? data.motion : 'N/A');
        setGpsLocation({
          latitude: data.latitude !== undefined ? parseFloat(data.latitude).toFixed(6) : 'N/A',
          longitude: data.longitude !== undefined ? parseFloat(data.longitude).toFixed(6) : 'N/A',
          geolat: data.geolat !== undefined ? parseFloat(data.geolat).toFixed(6) : 'N/A',
          geolong: data.geolong !== undefined ? parseFloat(data.geolong).toFixed(6) : 'N/A'
        });
      }
    });

    return () => off(rootDataRef, 'value', unsubscribeRootData);
  }, [database, user]); // Added user to dependencies

  // Initialize Google Map
  useEffect(() => {
    // Only initialize map if user is logged in
    if (!user) {
        if (googleMap.current) {
            googleMap.current = null;
            googleMarker.current = null;
            const script = document.getElementById('google-maps-script');
            if (script) {
                script.remove();
            }
        }
        return;
    }

    const initMap = () => {
      if (mapRef.current && window.google) {
        const initialLatLng = { lat: 6.4419, lng: 100.1989 };
        googleMap.current = new window.google.maps.Map(mapRef.current, {
          center: initialLatLng,
          zoom: 16,
          fullscreenControl: false,
          mapTypeControl: false,
          streetViewControl: false,
        });
        googleMarker.current = new window.google.maps.Marker({
          position: initialLatLng,
          map: googleMap.current,
          title: 'RC Car Location',
        });
      }
    };

    if (MAPS_API_KEY && MAPS_API_KEY !== 'YOUR_Maps_API_KEY') {
      const script = document.createElement('script');
      script.id = 'google-maps-script';
      script.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_API_KEY}&callback=initMap`;
      script.async = true;
      script.defer = true;
      window.initMap = initMap;
      document.head.appendChild(script);
    }
  }, [user]); // Added user to dependencies

  // Update Map Marker
  useEffect(() => {
    // Only update map marker if user is logged in
    if (!user || !googleMap.current || !googleMarker.current) return;

    const currentLat = gpsSource === 'NEO6' ? gpsLocation.latitude : gpsLocation.geolat;
    const currentLng = gpsSource === 'NEO6' ? gpsLocation.longitude : gpsLocation.geolong;

    const latNum = parseFloat(currentLat);
    const lngNum = parseFloat(currentLng);

    if (!isNaN(latNum) && !isNaN(lngNum)) {
      const newLatLng = new window.google.maps.LatLng(latNum, lngNum);
      googleMarker.current.setPosition(newLatLng);
      googleMap.current.setCenter(newLatLng);
    }
  }, [gpsLocation, gpsSource, user]); // Added user to dependencies

  // Joystick Control Functions
  const getDominantDirection = useCallback((x, y) => {
    const normalizedX = x / joystickRadius;
    const normalizedY = y / joystickRadius;
    const distFromCenter = Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY);

    if (distFromCenter < (deadZoneRadius / joystickRadius)) return "CENTER";

    const absNormalizedX = Math.abs(normalizedX);
    const absNormalizedY = Math.abs(normalizedY);

    if (absNormalizedX > absNormalizedY * axisPriorityThreshold) {
      return normalizedX > 0 ? "RIGHTY" : "LEFTY";
    }
    return normalizedY > 0 ? "DOWN" : "UP";
  }, [joystickRadius, deadZoneRadius, axisPriorityThreshold]);

  const handleJoystickStart = useCallback((clientX, clientY) => {
    if (!user) return; // Only allow joystick control if logged in
    setIsDragging(true);
    const container = joystickContainerRef.current;
    if (container) {
      const rect = container.getBoundingClientRect();
      const newX = clientX - rect.left - rect.width / 2;
      const newY = clientY - rect.top - rect.height / 2;
      setJoystickPos({ x: newX, y: newY });
      setCurrentDirection(getDominantDirection(newX, newY));
    }
  }, [getDominantDirection, user]); // Added user to dependencies

  const handleJoystickMove = useCallback((clientX, clientY, event) => {
    if (!isDragging || !user) return; // Only allow joystick control if logged in
    // Only prevent default on mobile for smooth joystick dragging
    if (isMobile && event?.cancelable) event.preventDefault();

    const container = joystickContainerRef.current;
    if (container) {
      const rect = container.getBoundingClientRect();
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      let newX = clientX - rect.left - centerX;
      let newY = clientY - rect.top - centerY;
      const distance = Math.sqrt(newX * newX + newY * newY);

      if (distance > joystickRadius) {
        newX = (newX / distance) * joystickRadius;
        newY = (newY / distance) * joystickRadius;
      }

      setJoystickPos({ x: newX, y: newY });
      setCurrentDirection(getDominantDirection(newX, newY));
    }
  }, [isDragging, joystickRadius, getDominantDirection, isMobile, user]); // Added user to dependencies

  const handleJoystickEnd = useCallback(() => {
    if (!user) return; // Only allow joystick control if logged in
    setIsDragging(false);
    setJoystickPos({ x: 0, y: 0 });
    setCurrentDirection("CENTER");
  }, [user]); // Added user to dependencies

  // Joystick Event Listeners
  useEffect(() => {
    if (mode === CONTROL_MODE.JOYSTICK && user) { // Only attach listeners if in joystick mode AND logged in
      const onMouseMove = (e) => handleJoystickMove(e.clientX, e.clientY, e);
      const onMouseUp = handleJoystickEnd;
      const onTouchMove = (e) => {
        if (e.touches.length > 0) handleJoystickMove(e.touches[0].clientX, e.touches[0].clientY, e);
      };
      const onTouchEnd = handleJoystickEnd;

      if (isDragging) {
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        // Explicitly set passive: false for touchmove to allow preventDefault
        window.addEventListener('touchmove', onTouchMove, { passive: false });
        window.addEventListener('touchend', onTouchEnd);
      }

      return () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        window.removeEventListener('touchmove', onTouchMove);
        window.removeEventListener('touchend', onTouchEnd);
      };
    }
  }, [isDragging, handleJoystickMove, handleJoystickEnd, mode, user]); // Added user to dependencies

  // Control Button Handlers
  const handleDirectionPress = useCallback((direction, event) => {
    if (!user) return; // Only allow control if logged in
    // Only prevent default on mobile touch events for buttons
    if (isMobile && event?.cancelable) {
      event.preventDefault();
    }
    setCurrentDirection(direction);
  }, [isMobile, user]); // Added user to dependencies

  const handleDirectionRelease = useCallback(() => {
    if (!user) return; // Only allow control if logged in
    setCurrentDirection("CENTER");
  }, [user]); // Added user to dependencies

  const handleSprayPress = useCallback((sprayType, event) => {
    if (!user) return; // Only allow spray if logged in
    // Only prevent default on mobile touch events for buttons
    if (isMobile && event?.cancelable) {
      event.preventDefault();
    }
    sprayType === "left" ? setSprayLeftActive(true) : setSprayRightActive(true);
  }, [isMobile, user]); // Added user to dependencies

  const handleSprayRelease = useCallback((sprayType) => {
    if (!user) return; // Only allow spray if logged in
    sprayType === "left" ? setSprayLeftActive(false) : setSprayRightActive(false);
  }, [user]); // Added user to dependencies

  const toggleSpeed = () => {
    if (!user) return; // Only allow speed change if logged in
    const newSpeed = (speed % 3) + 1;
    setSpeed(newSpeed);

    if (database) {
      const updates = {
        speed: String(newSpeed) // Must be wrapped in an object
      };

      update(ref(database, "/"), updates).catch((e) => {
        console.error("Failed to update speed:", e);
      });
    }
  };

  const toggleControlMode = () => {
    if (!user) return; // Only allow mode toggle if logged in
    setMode(prev => prev === CONTROL_MODE.ARROWS ? CONTROL_MODE.JOYSTICK : CONTROL_MODE.ARROWS);
    setCurrentDirection("CENTER");
    setSprayLeftActive(false);
    setSprayRightActive(false);
  };

  // Button Styles (kept separate for readability)
  const buttonClass = "w-20 h-20 bg-blue-500 text-white text-base font-bold rounded-lg shadow-md flex items-center justify-center " +
    "hover:bg-blue-600 active:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-75 " +
    "transition-all duration-150 ease-in-out transform active:scale-95 select-none";

  const sprayButtonJoystickClass = "w-24 h-16 bg-green-500 text-white text-xl font-bold rounded-lg shadow-md flex items-center justify-center " +
    "hover:bg-green-600 active:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-opacity-75 " +
    "transition-all duration-150 ease-in-out transform active:scale-95 select-none";

  const mainBoxStyleClass = "mt-4 p-6 bg-white rounded-lg shadow-xl w-full max-w-2xl text-center";

  // --- CONDITIONAL RENDERING: LOGIN PAGE vs. MAIN APP ---
  if (loadingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <p className="text-xl text-gray-700">Loading authentication...</p>
      </div>
    );
  }

  if (!user) {
    // Render Login Page if no user is logged in
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
        <div className="bg-white p-8 rounded-lg shadow-xl w-full max-w-md">
          <h2 className="text-3xl font-bold text-center text-blue-700 mb-6">Login to PERO System</h2>
          <form onSubmit={handleLogin}>
            <div className="mb-4">
              <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="login-email">
                Email
              </label>
              <input
                type="email"
                id="login-email"
                className="shadow appearance-none border rounded w-full py-3 px-4 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter your email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                required
              />
            </div>
            <div className="mb-6">
              <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="login-password">
                Password
              </label>
              <input
                type="password"
                id="login-password"
                className="shadow appearance-none border rounded w-full py-3 px-4 text-gray-700 mb-3 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="********"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                required
              />
            </div>
            {loginError && <p className="text-red-500 text-xs italic mb-4 text-center">{loginError}</p>}
            <div className="flex items-center justify-center">
              <button
                type="submit"
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg focus:outline-none focus:shadow-outline transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={loggingIn}
              >
                {loggingIn ? 'Logging in...' : 'Login'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // Render Main Application if user is logged in
  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center p-4 font-inter">
      <header className="w-full bg-blue-700 text-white p-4 shadow-lg fixed top-0 left-0 z-10">
        <div className="container mx-auto flex justify-between items-center">
          <h1 className="text-xl md:text-3xl font-bold">PERO Monitoring System</h1>
          {user && ( // Show logout button only when user is logged in
            <div className="flex items-center space-x-2 text-sm md:text-base">
              <span className="hidden md:inline">Logged in as: {user.email}</span>
              <button
                onClick={handleLogout}
                className="px-3 py-1 bg-red-600 text-white rounded-md shadow-sm hover:bg-red-700 transition-colors duration-200"
              >
                Logout
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="flex flex-col items-center justify-center pt-20 pb-4 w-full max-w-2xl mx-auto">

        {/* Camera Stream Section */}
        <div className="w-full bg-white-800 rounded-lg shadow-lg mb-4 overflow-hidden flex flex-col items-center justify-center aspect-video">
          {videoStreamError && !lastGoodStreamUrl ? (
            <div className="p-4 bg-white border border-red-500 rounded-lg text-gray-800 w-full h-full flex flex-col justify-center items-center">
              <p className="text-4xl">❌</p>
              <p className="text-xl font-bold text-red-700 mt-2">CAMERA OFFLINE</p>
              <button
                onClick={handleManualReconnect}
                className="mt-4 px-6 py-2 bg-red-600 text-white font-bold rounded-lg shadow-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-opacity-75 transition-all duration-200 ease-in-out transform hover:scale-105"
              >
                Attempt Reconnect
              </button>
            </div>
          ) : (
            <iframe
              ref={iframeRef}
              src={cctvStream}
              title="CCTV Camera"
              frameBorder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="full"
              style={{ width: '50%', height: '25vh', margin: '0 auto', display: 'block' }}
              onError={() => {
                setVideoStreamError(true);
                if (cctvStream !== lastGoodStreamUrl && lastGoodStreamUrl) {
                  setCctvStream(lastGoodStreamUrl);
                } else if (!lastGoodStreamUrl) {
                  setCctvStream("");
                }
              }}
            ></iframe>
          )}
        </div>

        {/* Control Panel */}
        <div className={mainBoxStyleClass}>
          {mode === CONTROL_MODE.ARROWS ? (
            <div className="grid grid-cols-3 gap-2 p-4 bg-gray-200 rounded-lg w-fit mx-auto mb-4">
              <button
                onMouseDown={(e) => handleSprayPress("left", e)}
                onMouseUp={() => handleSprayRelease("left")}
                onTouchStart={(e) => handleSprayPress("left", e)}
                onTouchEnd={() => handleSprayRelease("left")}
                className={buttonClass}
              >
                Spray Left
              </button>
              <button
                onMouseDown={(e) => handleDirectionPress("UP", e)}
                onMouseUp={() => handleDirectionRelease()}
                onTouchStart={(e) => handleDirectionPress("UP", e)}
                onTouchEnd={() => handleDirectionRelease()}
                className={buttonClass}
              >
                ↑
              </button>
              <button
                onMouseDown={(e) => handleSprayPress("right", e)}
                onMouseUp={() => handleSprayRelease("right")}
                onTouchStart={(e) => handleSprayPress("right", e)}
                onTouchEnd={() => handleSprayRelease("right")}
                className={buttonClass}
              >
                Spray Right
              </button>

              <button
                onMouseDown={(e) => handleDirectionPress("LEFTY", e)}
                onMouseUp={() => handleDirectionRelease()}
                onTouchStart={(e) => handleDirectionPress("LEFTY", e)}
                onTouchEnd={() => handleDirectionRelease()}
                className={buttonClass}
              >
                ←
              </button>
              <div className="w-20 h-20 flex items-center justify-center"></div>
              <button
                onMouseDown={(e) => handleDirectionPress("RIGHTY", e)}
                onMouseUp={() => handleDirectionRelease()}
                onTouchStart={(e) => handleDirectionPress("RIGHTY", e)}
                onTouchEnd={() => handleDirectionRelease()}
                className={buttonClass}
              >
                →
              </button>

              <div className="col-start-2">
                <button
                  onMouseDown={(e) => handleDirectionPress("DOWN", e)}
                  onMouseUp={() => handleDirectionRelease()}
                  onTouchStart={(e) => handleDirectionPress("DOWN", e)}
                  onTouchEnd={() => handleDirectionRelease()}
                  className={buttonClass}
                >
                  ↓
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center space-y-4 mb-4">
              <div
                ref={joystickContainerRef}
                className="relative w-40 h-40 bg-gray-300 rounded-full shadow-lg flex items-center justify-center cursor-grab active:cursor-grabbing"
                onMouseDown={(e) => handleJoystickStart(e.clientX, e.clientY)}
                onTouchStart={(e) => {
                  if (e.touches.length > 0) {
                    if (isMobile && e.cancelable) {
                      e.preventDefault();
                    }
                    handleJoystickStart(e.touches[0].clientX, e.touches[0].clientY);
                  }
                }}
              >
                <div
                  ref={joystickKnobRef}
                  className="absolute w-20 h-20 bg-blue-500 rounded-full shadow-md transition-transform duration-75 ease-out"
                  style={{ transform: `translate(${joystickPos.x}px, ${joystickPos.y}px)` }}
                />
              </div>
              <div className="flex justify-center space-x-4">
                <button
                  onMouseDown={(e) => handleSprayPress("left", e)}
                  onMouseUp={() => handleSprayRelease("left")}
                  onTouchStart={(e) => handleSprayPress("left", e)}
                  onTouchEnd={() => handleSprayRelease("left")}
                  className={sprayButtonJoystickClass}
                >
                  Spray Left
                </button>
                <button
                  onMouseDown={(e) => handleSprayPress("right", e)}
                  onMouseUp={() => handleSprayRelease("right")}
                  onTouchStart={(e) => handleSprayPress("right", e)}
                  onTouchEnd={() => handleSprayRelease("right")}
                  className={sprayButtonJoystickClass}
                >
                  Spray Right
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-col items-center space-y-4">
            <button
              onClick={toggleSpeed}
              className="px-6 py-3 bg-indigo-600 text-white font-bold rounded-lg shadow-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-opacity-75 transition-all duration-200 ease-in-out transform hover:scale-105"
            >
              Cycle Speed (Current: {speed})
            </button>

            <button
              onClick={toggleControlMode}
              className="px-6 py-3 bg-purple-600 text-white font-bold rounded-lg shadow-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-opacity-75 transition-all duration-200 ease-in-out transform hover:scale-105"
            >
              Switch to {mode === CONTROL_MODE.ARROWS ? "Joystick" : "Arrow Buttons"} Mode
            </button>

            <div className="text-center mt-4">
              <p className="text-2xl font-semibold text-gray-700">
                Direction: <span className="text-blue-600">{currentDirection}</span>
              </p>
              <p className="text-2xl font-semibold text-gray-700">
                Speed: <span className="text-green-600">{speed}</span>
              </p>
              <p className="text-lg font-semibold text-gray-700">
                Spray Left: <span className={sprayLeftActive ? "text-red-500" : "text-gray-400"}>{sprayLeftActive ? "ON" : "OFF"}</span>
              </p>
              <p className="text-lg font-semibold text-gray-700">
                Spray Right: <span className={sprayRightActive ? "text-red-500" : "text-gray-400"}>{sprayRightActive ? "ON" : "OFF"}</span>
              </p>
            </div>
          </div>
        </div>

        {/* Sensor Data Section */}
        <div className={mainBoxStyleClass}>
          <h2 className="text-xl font-bold mb-2 text-gray-800">Sensor Data</h2>
          <p className="text-lg font-semibold text-gray-700">
            Accelerometer:
            <span className="text-purple-600">
              X: {accelerometerData.x}, Y: {accelerometerData.y}, Z: {accelerometerData.z}
            </span>
          </p>
          <p className="text-lg font-semibold text-gray-700 mt-2">
            Ultrasonic Distance: <span className="text-orange-600">{ultrasonicDistance} cm</span>
          </p>
          <p className="text-lg font-semibold text-gray-700 mt-2">
            Motion: <span className={motionStatus === "YES" ? "text-green-500" : "text-red-500"}>{motionStatus}</span>
          </p>
        </div>

        {/* GPS Data Section */}
        <div className={mainBoxStyleClass}>
          <h2 className="text-xl font-bold mb-2 text-gray-800">GPS Location</h2>
          <div className="flex items-center justify-center space-x-4 mb-4">
            <button
              onClick={() => setGpsSource('NEO6')}
              className={`px-4 py-2 rounded-lg font-bold transition-colors duration-200 ${gpsSource === 'NEO6' ? 'bg-blue-600 text-white' : 'bg-gray-300 text-gray-700 hover:bg-gray-400'}`}
            >
              NEO6
            </button>
            <button
              onClick={() => setGpsSource('GEOLOCATION')}
              className={`px-4 py-2 rounded-lg font-bold transition-colors duration-200 ${gpsSource === 'GEOLOCATION' ? 'bg-blue-600 text-white' : 'bg-gray-300 text-gray-700 hover:bg-gray-400'}`}
            >
              GEOLOCATION
            </button>
          </div>
          {gpsSource === 'NEO6' ? (
            <div>
              <p className="text-lg font-semibold text-gray-700">
                Lat: <span className="text-teal-600">{gpsLocation.latitude}</span>
              </p>
              <p className="text-lg font-semibold text-gray-700">
                Long: <span className="text-teal-600">{gpsLocation.longitude}</span>
              </p>
            </div>
          ) : (
            <div>
              <p className="text-lg font-semibold text-gray-700">
                Geo Lat: <span className="text-teal-600">{gpsLocation.geolat}</span>
              </p>
              <p className="text-lg font-semibold text-gray-700">
                Geo Long: <span className="text-teal-600">{gpsLocation.geolong}</span>
              </p>
            </div>
          )}
        </div>

        {/* Map Section */}
        <div className={mainBoxStyleClass}>
          <h2 className="text-xl font-bold mb-4 text-gray-800">Live Vehicle Location on Map</h2>
          {MAPS_API_KEY === "AIzaSyCzEccIZNFiLG8VnIp-btN5IYXZkZkb7Kc" ? (
            <div ref={mapRef} className="w-full" style={{ height: '400px' }} />
          ) : (
            null
          )}
        </div>
      </div>

      <div className="mt-8 text-gray-500 text-sm text-center pb-4">
        {mode === CONTROL_MODE.ARROWS ? (
          <p>Press and hold the on-screen arrow buttons to control direction and spray.</p>
        ) : (
          <p>Drag the joystick to control direction. Use the buttons below for spray.</p>
        )}
        <p>Click the "Cycle Speed" button to change speed.</p>
      </div>
    </div>
  );
}

export default App;