import React, { useState, useEffect, useRef, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set } from 'firebase/database';

// Firebase Config - Using process.env variables as requested by the user
// IMPORTANT: Ensure these environment variables are correctly set in your deployment environment.
// In some live environments (like this Canvas), process.env might not be directly available.
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  databaseURL: "https://rc-car-74710-default-rtdb.asia-southeast1.firebasedatabase.app/",
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
};

// Basic validation for Firebase config
if (!firebaseConfig.apiKey || !firebaseConfig.databaseURL || !firebaseConfig.projectId) {
  console.warn("Firebase configuration is incomplete or missing values from process.env. This might lead to initialization errors.");
}

// Firebase Initialization - Moved outside the App component
const app = initializeApp(firebaseConfig);
const database = getDatabase(app); // Global Realtime Database instance
console.log("Firebase Realtime Database initialized globally with user-provided config.");


// Define control modes
const CONTROL_MODE = {
  JOYSTICK: 'JOYSTICK',
  ARROWS: 'ARROWS'
};

// Main App component
function App() {
  // State for current control mode
  const [mode, setMode] = useState(CONTROL_MODE.ARROWS); // Start with arrows as default

  // State for current direction and speed
  const [currentDirection, setCurrentDirection] = useState("CENTER");
  const [speed, setSpeed] = useState(1);

  // Refs for joystick elements (only used in JOYSTICK mode)
  const joystickContainerRef = useRef(null);
  const joystickKnobRef = useRef(null);

  // Constants for joystick calibration (adjust as needed for UI)
  const joystickRadius = 70; // Radius of the joystick movement area
  const deadZoneRadius = 20; // Radius for the "CENTER" dead zone
  const axisPriorityThreshold = 0.5; // Relative threshold for dominant axis (0 to 1)

  // State for joystick position and dragging status (only used in JOYSTICK mode)
  const [joystickPos, setJoystickPos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  // Function to update Firebase Realtime Database with current direction and speed
  const updateFirebase = useCallback(async (dir, spd) => {
    // Check if the global 'database' instance is available
    if (!database) {
      console.log("Firebase Realtime DB not initialized.");
      return;
    }

    try {
      // Use firebaseConfig.appId for the Realtime Database path
      const appIdentifierForPath = firebaseConfig.appId || 'default-app-id';
      const dbPath = "/"; // Matches ESP32's firebasePath = "/"
      const dbRef = ref(database, dbPath); // Use the global 'database' instance

      // Set the direction and speed values at the root
      // The ESP32 code reads /up, /down, /left, /right, /speed
      // So we update these specific keys.
      await set(dbRef, {
        up: dir === "UP" ? "1" : "0",
        down: dir === "DOWN" ? "1" : "0",
        left: dir === "LEFTY" ? "1" : "0",
        right: dir === "RIGHTY" ? "1" : "0",
        speed: String(spd), // Ensure speed is sent as a string to match ESP32's String(speed)
        timestamp: new Date().toISOString(), // Add a timestamp for debugging/tracking
      });
      console.log(`Firebase Realtime DB updated: Path=${dbPath}, Direction=${dir}, Speed=${spd}`);
    } catch (e) {
      console.error("Error updating Realtime Database: ", e);
    }
  }, []); // No dependencies related to Firebase instance as it's global

  // Effect to update Firebase when direction or speed changes
  useEffect(() => {
    // Trigger update Firebase whenever direction or speed changes
    updateFirebase(currentDirection, speed);
  }, [currentDirection, speed, updateFirebase]);

  // Joystick specific functions
  const getDominantDirection = useCallback((x, y) => {
    const normalizedX = x / joystickRadius;
    const normalizedY = y / joystickRadius;
    const distFromCenter = Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY);

    if (distFromCenter < (deadZoneRadius / joystickRadius)) {
      return "CENTER";
    }

    const absNormalizedX = Math.abs(normalizedX);
    const absNormalizedY = Math.abs(normalizedY);

    if (absNormalizedX > absNormalizedY * axisPriorityThreshold) {
      return normalizedX > 0 ? "RIGHTY" : "LEFTY";
    } else if (absNormalizedY > absNormalizedX * axisPriorityThreshold) {
      return normalizedY > 0 ? "DOWN" : "UP";
    }
    return "CENTER";
  }, [joystickRadius, deadZoneRadius, axisPriorityThreshold]);

  const handleJoystickStart = useCallback((clientX, clientY) => {
    setIsDragging(true);
    const container = joystickContainerRef.current;
    if (container) {
      const rect = container.getBoundingClientRect();
      const newX = clientX - rect.left - rect.width / 2;
      const newY = clientY - rect.top - rect.height / 2;
      setJoystickPos({ x: newX, y: newY });
      setCurrentDirection(getDominantDirection(newX, newY));
    }
  }, [getDominantDirection]);

  const handleJoystickMove = useCallback((clientX, clientY) => {
    if (!isDragging) return;
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
  }, [isDragging, joystickRadius, getDominantDirection]);

  const handleJoystickEnd = useCallback(() => {
    setIsDragging(false);
    setJoystickPos({ x: 0, y: 0 });
    setCurrentDirection("CENTER");
  }, []);

  useEffect(() => {
    if (mode === CONTROL_MODE.JOYSTICK) {
      const onMouseMove = (e) => handleJoystickMove(e.clientX, e.clientY);
      const onMouseUp = handleJoystickEnd;
      const onTouchMove = (e) => {
        if (e.touches.length > 0) handleJoystickMove(e.touches[0].clientX, e.touches[0].clientY);
      };
      const onTouchEnd = handleJoystickEnd;

      if (isDragging) {
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        window.addEventListener('touchmove', onTouchMove, { passive: false });
        window.addEventListener('touchend', onTouchEnd);
      } else {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        window.removeEventListener('touchmove', onTouchMove);
        window.removeEventListener('touchend', onTouchEnd);
      };

      return () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        window.removeEventListener('touchmove', onTouchMove);
        window.removeEventListener('touchend', onTouchEnd);
      };
    }
  }, [isDragging, handleJoystickMove, handleJoystickEnd, mode]);

  // Arrow button specific functions
  const handleDirectionPress = useCallback((direction) => {
    setCurrentDirection(direction);
  }, []);

  const handleDirectionRelease = useCallback(() => {
    setCurrentDirection("CENTER");
  }, []);

  // Function to cycle speed
  const toggleSpeed = () => {
    setSpeed(prevSpeed => (prevSpeed % 3) + 1);
  };

  // Function to toggle control mode
  const toggleControlMode = () => {
    setMode(prevMode =>
      prevMode === CONTROL_MODE.ARROWS ? CONTROL_MODE.JOYSTICK : CONTROL_MODE.ARROWS
    );
    setCurrentDirection("CENTER");
  };

  // Common button styling
  const buttonClass = "w-20 h-20 bg-blue-500 text-white text-3xl font-bold rounded-lg shadow-md flex items-center justify-center " +
                      "hover:bg-blue-600 active:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-75 " +
                      "transition-all duration-150 ease-in-out transform active:scale-95";

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center p-4 font-inter">
      {/* Header */}
      <header className="w-full bg-blue-700 text-white p-4 shadow-lg fixed top-0 left-0 z-10">
        <div className="container mx-auto flex justify-between items-center">
          <h1 className="text-xl md:text-3xl font-bold">PERO Monitoring System</h1>
          {/* You can add navigation links or other elements here if needed */}
        </div>
      </header>

      {/* Main content area - adjusted padding to account for fixed header */}
      <div className="flex flex-col items-center justify-center pt-20 pb-4"> {/* Added pt-20 to push content below fixed header */}
        {/* Control Panel */}
        <div className="mt-8 p-6 bg-white rounded-lg shadow-xl flex flex-col items-center space-y-4">
          <p className="text-2xl font-semibold text-gray-700">
            Direction: <span className="text-blue-600">{currentDirection}</span>
          </p>
          <p className="text-2xl font-semibold text-gray-700">
            Speed: <span className="text-green-600">{speed}</span>
          </p>

          {/* Mode Toggle Button */}
          <button
            onClick={toggleControlMode}
            className="px-6 py-3 bg-purple-600 text-white font-bold rounded-lg shadow-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-opacity-75 transition-all duration-200 ease-in-out transform hover:scale-105"
          >
            Switch to {mode === CONTROL_MODE.ARROWS ? "Joystick" : "Arrow Buttons"} Mode
          </button>

          {/* Conditional Rendering of Control Interface */}
          {mode === CONTROL_MODE.ARROWS ? (
            // Directional Buttons Grid (Arrow Mode)
            <div className="grid grid-cols-3 gap-2 p-4 bg-gray-200 rounded-lg">
              <div className="col-start-2">
                <button
                  onMouseDown={() => handleDirectionPress("UP")}
                  onMouseUp={handleDirectionRelease}
                  onTouchStart={() => handleDirectionPress("UP")}
                  onTouchEnd={handleDirectionRelease}
                  className={buttonClass}
                >
                  ↑
                </button>
              </div>
              <div className="col-start-1">
                <button
                  onMouseDown={() => handleDirectionPress("LEFTY")}
                  onMouseUp={handleDirectionRelease}
                  onTouchStart={() => handleDirectionPress("LEFTY")}
                  onTouchEnd={handleDirectionRelease}
                  className={buttonClass}
                >
                  ←
                </button>
              </div>
              <div>
                {/* Center placeholder for layout */}
                <div className="w-20 h-20 flex items-center justify-center"></div>
              </div>
              <div>
                <button
                  onMouseDown={() => handleDirectionPress("RIGHTY")}
                  onMouseUp={handleDirectionRelease}
                  onTouchStart={() => handleDirectionPress("RIGHTY")}
                  onTouchEnd={handleDirectionRelease}
                  className={buttonClass}
                >
                  →
                </button>
              </div>
              <div className="col-start-2">
                <button
                  onMouseDown={() => handleDirectionPress("DOWN")}
                  onMouseUp={handleDirectionRelease}
                  onTouchStart={() => handleDirectionPress("DOWN")}
                  onTouchEnd={handleDirectionRelease}
                  className={buttonClass}
                >
                  ↓
                </button>
              </div>
            </div>
          ) : (
            // Joystick Container (Joystick Mode)
            <div
              ref={joystickContainerRef}
              className="relative w-40 h-40 bg-gray-300 rounded-full shadow-lg flex items-center justify-center cursor-grab active:cursor-grabbing"
              onMouseDown={(e) => handleJoystickStart(e.clientX, e.clientY)}
              onTouchStart={(e) => {
                if (e.touches.length > 0) handleJoystickStart(e.touches[0].clientX, e.touches[0].clientY);
              }}
            >
              {/* Joystick Knob */}
              <div
                ref={joystickKnobRef}
                className="absolute w-20 h-20 bg-blue-500 rounded-full shadow-md transition-transform duration-75 ease-out"
                style={{
                  transform: `translate(${joystickPos.x}px, ${joystickPos.y}px)`,
                }}
              ></div>
            </div>
          )}

          {/* Speed Toggle Button */}
          <button
            onClick={toggleSpeed}
            className="px-6 py-3 bg-indigo-600 text-white font-bold rounded-lg shadow-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-opacity-75 transition-all duration-200 ease-in-out transform hover:scale-105"
          >
            Cycle Speed (Current: {speed})
          </button>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-8 text-gray-500 text-sm text-center">
        {mode === CONTROL_MODE.ARROWS ? (
          <p>Press and hold the on-screen arrow buttons to control direction.</p>
        ) : (
          <p>Drag the joystick to control direction.</p>
        )}
        <p>Click the "Cycle Speed" button to change speed.</p>
        <p>Data is sent to Firebase Realtime Database.</p>
      </div>
    </div>
  );
}

export default App;
