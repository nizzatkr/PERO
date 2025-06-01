import React, { useState, useEffect, useRef, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set } from 'firebase/database';

// Firebase Config - Using process.env variables as explicitly requested by the user
// IMPORTANT: As previously discussed, in some live environments (like this Canvas),
// process.env variables might not be directly available. If you encounter errors
// like "process is not defined" or "apiKey is undefined", it means these
// environment variables are not being set at runtime in this specific environment.
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
  console.warn("Firebase configuration is incomplete or missing values from process.env. This might lead to initialization errors if environment variables are not set.");
}

// Firebase Initialization - Moved outside the App component
const app = initializeApp(firebaseConfig);
const database = getDatabase(app); // Global Realtime Database instance
console.log("Firebase Realtime Database initialized globally with user-provided process.env config.");


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

  // New states for spray buttons
  const [sprayLeftActive, setSprayLeftActive] = useState(false);
  const [sprayRightActive, setSprayRightActive] = useState(false);

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
  const updateFirebase = useCallback(async (dir, spd, sLeftActive, sRightActive) => { // Added spray states
    // Check if the global 'database' instance is available
    if (!database) {
      console.log("Firebase Realtime DB not initialized.");
      return;
    }

    try {
      // Use firebaseConfig.appId for the Realtime Database path
      // This will be undefined if process.env.REACT_APP_FIREBASE_APP_ID is not set.
      const appIdentifierForPath = firebaseConfig.appId || 'default-app-id';
      const dbPath = "/"; // Matches ESP32's firebasePath = "/"
      const dbRef = ref(database, dbPath); // Use the global 'database' instance

      // Set the direction and speed values at the root
      // The ESP32 code reads /up, /down, /left, /right, /speed
      // Now also /spray_left and /spray_right
      await set(dbRef, {
        up: dir === "UP" ? "1" : "0",
        down: dir === "DOWN" ? "1" : "0",
        left: dir === "LEFTY" ? "1" : "0",
        right: dir === "RIGHTY" ? "1" : "0",
        speed: String(spd), // Ensure speed is sent as a string to match ESP32's String(speed)
        spray_left: sLeftActive ? "1" : "0", // Send spray_left state
        spray_right: sRightActive ? "1" : "0", // Send spray_right state
        timestamp: new Date().toISOString(), // Add a timestamp for debugging/tracking
      });
      console.log(`Firebase Realtime DB updated: Path=${dbPath}, Direction=${dir}, Speed=${spd}, SprayLeft=${sLeftActive}, SprayRight=${sRightActive}`);
    } catch (e) {
      console.error("Error updating Realtime Database: ", e);
    }
  }, []); // No dependencies related to Firebase instance as it's global

  // Effect to update Firebase when direction, speed, or spray states change
  useEffect(() => {
    // Trigger update Firebase whenever direction, speed, or spray states change
    updateFirebase(currentDirection, speed, sprayLeftActive, sprayRightActive);
  }, [currentDirection, speed, sprayLeftActive, sprayRightActive, updateFirebase]);

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

  const handleJoystickMove = useCallback((clientX, clientY, event) => { // Added 'event' parameter
    if (!isDragging) return;

    // Prevent default touch behavior (like pull-to-refresh)
    if (event && event.cancelable) { // Check if event is cancelable
      event.preventDefault();
    }

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
      const onMouseMove = (e) => handleJoystickMove(e.clientX, e.clientY, e); // Pass event
      const onMouseUp = handleJoystickEnd;
      const onTouchMove = (e) => {
        if (e.touches.length > 0) handleJoystickMove(e.touches[0].clientX, e.touches[0].clientY, e); // Pass event
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
  const handleDirectionPress = useCallback((direction, event) => {
    // Prevent default touch/mouse behavior for long-press menus or text selection
    if (event) {
      event.preventDefault();
    }
    setCurrentDirection(direction);
  }, []);

  const handleDirectionRelease = useCallback(() => {
    setCurrentDirection("CENTER");
  }, []);

  // New handlers for spray buttons
  const handleSprayPress = useCallback((sprayType, event) => {
    if (event) event.preventDefault(); // Prevent default browser behavior
    if (sprayType === "left") {
      setSprayLeftActive(true);
    } else if (sprayType === "right") {
      setSprayRightActive(true);
    }
  }, []);

  const handleSprayRelease = useCallback((sprayType) => {
    if (sprayType === "left") {
      setSprayLeftActive(false);
    } else if (sprayType === "right") {
      setSprayRightActive(false);
    }
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
    // Also reset spray states when switching modes
    setSprayLeftActive(false);
    setSprayRightActive(false);
  };

  // Common button styling, including `select-none` for user-select: none
  const buttonClass = "w-20 h-20 bg-blue-500 text-white text-base font-bold rounded-lg shadow-md flex items-center justify-center " +
                      "hover:bg-blue-600 active:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-75 " +
                      "transition-all duration-150 ease-in-out transform active:scale-95 " +
                      "select-none"; // Added select-none to prevent text selection

  // Style for the new spray buttons when placed with joystick (can be adjusted)
  const sprayButtonJoystickClass = "w-24 h-16 bg-green-500 text-white text-xl font-bold rounded-lg shadow-md flex items-center justify-center " +
                                   "hover:bg-green-600 active:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-opacity-75 " +
                                   "transition-all duration-150 ease-in-out transform active:scale-95 " +
                                   "select-none";

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
          <p className="text-lg font-semibold text-gray-700">
            Spray Left: <span className={sprayLeftActive ? "text-red-500" : "text-gray-400"}>{sprayLeftActive ? "ON" : "OFF"}</span>
          </p>
          <p className="text-lg font-semibold text-gray-700">
            Spray Right: <span className={sprayRightActive ? "text-red-500" : "text-gray-400"}>{sprayRightActive ? "ON" : "OFF"}</span>
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
            // Arrow Mode Controls with integrated Spray buttons
            <div className="grid grid-cols-3 gap-2 p-4 bg-gray-200 rounded-lg">
              {/* Row 1: Spray Left, Up Arrow, Spray Right */}
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
                onMouseUp={handleDirectionRelease}
                onTouchStart={(e) => handleDirectionPress("UP", e)}
                onTouchEnd={handleDirectionRelease}
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

              {/* Row 2: Left Arrow, Center Placeholder, Right Arrow */}
              <button
                onMouseDown={(e) => handleDirectionPress("LEFTY", e)}
                onMouseUp={handleDirectionRelease}
                onTouchStart={(e) => handleDirectionPress("LEFTY", e)}
                onTouchEnd={handleDirectionRelease}
                className={buttonClass}
              >
                ←
              </button>
              <div>
                {/* Center placeholder for layout */}
                <div className="w-20 h-20 flex items-center justify-center"></div>
              </div>
              <button
                onMouseDown={(e) => handleDirectionPress("RIGHTY", e)}
                onMouseUp={handleDirectionRelease}
                onTouchStart={(e) => handleDirectionPress("RIGHTY", e)}
                onTouchEnd={handleDirectionRelease}
                className={buttonClass}
              >
                →
              </button>

              {/* Row 3: Down Arrow */}
              <div className="col-start-2">
                <button
                  onMouseDown={(e) => handleDirectionPress("DOWN", e)}
                  onMouseUp={handleDirectionRelease}
                  onTouchStart={(e) => handleDirectionPress("DOWN", e)}
                  onTouchEnd={handleDirectionRelease}
                  className={buttonClass}
                >
                  ↓
                </button>
              </div>
            </div>
          ) : (
            // Joystick Container (Joystick Mode) with Spray buttons
            <div className="flex flex-col items-center space-y-4"> {/* Added flex column for vertical stacking */}
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
                {/* Spray Buttons below the joystick */}
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
          <p>Press and hold the on-screen arrow buttons to control direction and spray.</p>
        ) : (
          <p>Drag the joystick to control direction. Use the buttons below for spray.</p>
        )}
        <p>Click the "Cycle Speed" button to change speed.</p>
        <p>Data is sent to Firebase Realtime Database.</p>
      </div>
    </div>
  );
}

export default App;
