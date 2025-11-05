document.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("staticCanvas");
  if (!canvas) {
    return;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  let animationFrameId;
  let isDarkMode = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const config = {
    pixelSize: 1.25,
    // Keep 1px for authentic fine-grained static
    density: 1,
    // Increased from original 0.8 for more dense static
    baseAlpha: 0.85,
    // Base alpha for normal mode
    alphaVariance: 0.25,
    // Alpha variance for normal mode
    // Color ranges (0-255) - Enhanced contrast
    darkIntensityMin: 30,
    // Brighter dots on dark bg
    darkIntensityMax: 100,
    // Wider range for better visibility
    lightIntensityMin: 135,
    // Darker dots on light bg
    lightIntensityMax: 200,
    // Wider range for better visibility
    // Frame timing
    frameInterval: 40,
    // Slightly increased from original for performance
    // Use partial redraw to improve performance
    usePartialRedraw: true,
    partialRedrawRatio: 0.4,
    // Redraw 40% of the static per frame
    maxStoredFrames: 5,
    // Store this many frames for cycling
    // Static calculation divisor (lower = more dots)
    staticDivisor: 42,
    // Reduced from 50 for higher density
    // Effect state tracking
    effectState: "normal",
    // Can be 'normal', 'intensifying', 'intense', 'fading'
    // Intense mode parameters (what we transition to)
    intenseDensity: 1.3,
    // Reduced from 1.5 for better performance
    intenseColor: [200, 120, 255],
    // Purple magic color
    // Transition parameters
    transitionProgress: 0,
    // Progress from 0-1
    transitionSpeed: 0.012,
    // How much to increment per frame
    // Effect parameters that will be dynamically calculated
    currentDensity: 0.66,
    // Will be updated during transitions
    currentColorMix: 0
    // 0 = normal colors, 1 = intense colors
  };
  let lastFrameTime = 0;
  let staticPixels = [];
  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    staticPixels = [];
  }
  function drawStatic(timestamp) {
    if (timestamp - lastFrameTime < config.frameInterval) {
      animationFrameId = requestAnimationFrame(drawStatic);
      return;
    }
    lastFrameTime = timestamp;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    updateEffectState();
    if (config.usePartialRedraw) {
      drawPartialStatic();
    } else {
      drawFullStatic();
    }
    if (config.effectState !== "normal" && config.transitionProgress > 0) {
      drawEffectLayer();
    }
    animationFrameId = requestAnimationFrame(drawStatic);
  }
  function drawFullStatic() {
    const screenRatio = Math.min(1, canvas.width * canvas.height / (1920 * 1080));
    const baseStaticDots = Math.floor(canvas.width * canvas.height / config.staticDivisor * config.density * screenRatio);
    const dotsByIntensity = {};
    for (let i = 0; i < baseStaticDots; i++) {
      const x = Math.floor(Math.random() * canvas.width);
      const y = Math.floor(Math.random() * canvas.height);
      let intensity;
      if (isDarkMode) {
        intensity = Math.floor(config.darkIntensityMin + Math.random() * (config.darkIntensityMax - config.darkIntensityMin));
      } else {
        intensity = Math.floor(config.lightIntensityMin + Math.random() * (config.lightIntensityMax - config.lightIntensityMin));
      }
      const alpha = config.baseAlpha + (Math.random() - 0.5) * config.alphaVariance;
      if (!dotsByIntensity[intensity]) {
        dotsByIntensity[intensity] = {
          coords: [],
          alpha
        };
      }
      dotsByIntensity[intensity].coords.push([x, y]);
    }
    for (const intensity in dotsByIntensity) {
      const dots = dotsByIntensity[intensity];
      ctx.fillStyle = `rgba(${intensity}, ${intensity}, ${intensity}, ${dots.alpha})`;
      for (const [x, y] of dots.coords) {
        ctx.fillRect(x, y, config.pixelSize, config.pixelSize);
      }
    }
  }
  function drawPartialStatic() {
    if (staticPixels.length < config.maxStoredFrames) {
      const newFrame = generateStaticFrame();
      staticPixels.push(newFrame);
      for (const frame of staticPixels) {
        drawStaticFrame(frame);
      }
    } else {
      staticPixels.shift();
      const partialFrame = generatePartialStaticFrame();
      staticPixels.push(partialFrame);
      for (const frame of staticPixels) {
        drawStaticFrame(frame);
      }
    }
  }
  function generateStaticFrame() {
    const screenRatio = Math.min(1, canvas.width * canvas.height / (1920 * 1080));
    const dotsPerFrame = Math.floor(canvas.width * canvas.height / config.staticDivisor * (config.density / config.maxStoredFrames) * screenRatio);
    const frameData = {};
    for (let i = 0; i < dotsPerFrame; i++) {
      const x = Math.floor(Math.random() * canvas.width);
      const y = Math.floor(Math.random() * canvas.height);
      let intensity;
      if (isDarkMode) {
        intensity = Math.floor(config.darkIntensityMin + Math.random() * (config.darkIntensityMax - config.darkIntensityMin));
      } else {
        intensity = Math.floor(config.lightIntensityMin + Math.random() * (config.lightIntensityMax - config.lightIntensityMin));
      }
      const alpha = config.baseAlpha + (Math.random() - 0.5) * config.alphaVariance;
      if (!frameData[intensity]) {
        frameData[intensity] = {
          alpha,
          pixels: []
        };
      }
      frameData[intensity].pixels.push([x, y]);
    }
    return frameData;
  }
  function generatePartialStaticFrame() {
    const screenRatio = Math.min(1, canvas.width * canvas.height / (1920 * 1080));
    const dotsPerPartialFrame = Math.floor(
      canvas.width * canvas.height / config.staticDivisor * (config.density / config.maxStoredFrames) * config.partialRedrawRatio * screenRatio
    );
    const frameData = {};
    for (let i = 0; i < dotsPerPartialFrame; i++) {
      const x = Math.floor(Math.random() * canvas.width);
      const y = Math.floor(Math.random() * canvas.height);
      let intensity;
      if (isDarkMode) {
        intensity = Math.floor(config.darkIntensityMin + Math.random() * (config.darkIntensityMax - config.darkIntensityMin));
      } else {
        intensity = Math.floor(config.lightIntensityMin + Math.random() * (config.lightIntensityMax - config.lightIntensityMin));
      }
      const alpha = config.baseAlpha + (Math.random() - 0.5) * config.alphaVariance;
      if (!frameData[intensity]) {
        frameData[intensity] = {
          alpha,
          pixels: []
        };
      }
      frameData[intensity].pixels.push([x, y]);
    }
    return frameData;
  }
  function drawStaticFrame(frameData) {
    for (const intensity in frameData) {
      const group = frameData[intensity];
      ctx.fillStyle = `rgba(${intensity}, ${intensity}, ${intensity}, ${group.alpha})`;
      for (const [x, y] of group.pixels) {
        ctx.fillRect(x, y, config.pixelSize, config.pixelSize);
      }
    }
  }
  function drawEffectLayer() {
    const screenRatio = Math.min(1, canvas.width * canvas.height / (1920 * 1080));
    const densityMultiplier = isDarkMode ? 60 : 50;
    const maxEffectDots = Math.floor(
      canvas.width * canvas.height / densityMultiplier * (config.intenseDensity - config.density) * config.transitionProgress * screenRatio
    );
    const effectDots = Math.min(maxEffectDots, 7e3);
    const effectColors = {
      purple: [],
      // Main effect color
      cyan: [],
      // Accent color
      white: []
      // Sparkles
    };
    for (let i = 0; i < effectDots; i++) {
      const x = Math.floor(Math.random() * canvas.width);
      const y = Math.floor(Math.random() * canvas.height);
      const colorRoll = Math.random();
      if (colorRoll > (isDarkMode ? 0.93 : 0.9)) {
        effectColors.white.push([x, y]);
      } else if (colorRoll > (isDarkMode ? 0.9 : 0.85)) {
        effectColors.cyan.push([x, y]);
      } else {
        effectColors.purple.push([x, y]);
      }
    }
    if (effectColors.purple.length > 0) {
      const colorIntensity = isDarkMode ? 0.85 : 1;
      const r = Math.floor(config.intenseColor[0] * colorIntensity);
      const g = Math.floor(config.intenseColor[1] * colorIntensity);
      const b = Math.floor(config.intenseColor[2] * colorIntensity);
      const baseAlpha = isDarkMode ? 0.75 : 0.9;
      const alpha = baseAlpha * config.transitionProgress;
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
      for (const [x, y] of effectColors.purple) {
        const dotSize = Math.random() > 0.95 ? 2 : 1;
        ctx.fillRect(x, y, dotSize, dotSize);
      }
    }
    if (effectColors.cyan.length > 0) {
      const alpha = (isDarkMode ? 0.6 : 0.8) * config.transitionProgress;
      ctx.fillStyle = `rgba(150, 230, 255, ${alpha})`;
      for (const [x, y] of effectColors.cyan) {
        ctx.fillRect(x, y, config.pixelSize, config.pixelSize);
      }
    }
    if (effectColors.white.length > 0) {
      const alpha = (isDarkMode ? 0.6 : 0.8) * config.transitionProgress;
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      for (const [x, y] of effectColors.white) {
        ctx.fillRect(x, y, 2, 2);
      }
    }
  }
  function updateEffectState() {
    switch (config.effectState) {
      case "intensifying":
        config.transitionProgress += config.transitionSpeed;
        if (config.transitionProgress >= 1) {
          config.transitionProgress = 1;
          config.effectState = "intense";
        }
        break;
      case "fading":
        config.transitionProgress -= config.transitionSpeed;
        if (config.transitionProgress <= 0) {
          config.transitionProgress = 0;
          config.effectState = "normal";
        }
        break;
    }
    updateCurrentParameters();
  }
  function updateCurrentParameters() {
    const easeInOut = config.transitionProgress < 0.5 ? 2 * config.transitionProgress * config.transitionProgress : 1 - Math.pow(-2 * config.transitionProgress + 2, 2) / 2;
    const minDensity = config.density * 0.9;
    config.currentDensity = Math.max(
      minDensity,
      config.density + (config.intenseDensity - config.density) * easeInOut
    );
    config.currentColorMix = easeInOut;
  }
  function updateMode(event) {
    isDarkMode = event.matches;
    staticPixels = [];
  }
  function enableMagicMode() {
    config.effectState = "normal";
    config.transitionProgress = 0;
  }
  function disableMagicMode() {
    config.effectState = "normal";
    config.transitionProgress = 0;
  }
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);
  config.effectState = "normal";
  config.transitionProgress = 0;
  updateCurrentParameters();
  const performanceData = {
    frameTimes: [],
    maxFrameTimes: 20,
    // Keep track of the last 20 frames
    slowFrameThreshold: 50,
    // ms, consider a frame "slow" if it takes more than this
    slowFrameCount: 0,
    adaptationThreshold: 5,
    // adapt after this many slow frames
    // Add a frame timing
    addFrameTime: function(duration) {
      this.frameTimes.push(duration);
      if (this.frameTimes.length > this.maxFrameTimes) {
        this.frameTimes.shift();
      }
      if (duration > this.slowFrameThreshold) {
        this.slowFrameCount++;
        if (this.slowFrameCount >= this.adaptationThreshold) {
          this.adaptSettings();
          this.slowFrameCount = 0;
        }
      }
    },
    // Adapt settings based on performance
    adaptSettings: function() {
      const avgFrameTime = this.frameTimes.reduce((sum, time) => sum + time, 0) / this.frameTimes.length;
      if (avgFrameTime > this.slowFrameThreshold) {
        if (config.density > 0.6) {
          config.density *= 0.9;
          config.staticDivisor *= 1.1;
        }
      }
    }
  };
  lastFrameTime = performance.now();
  animationFrameId = requestAnimationFrame(drawStatic);
  window.staticBackground = {
    enableMagicMode,
    // Transition to intense state
    disableMagicMode,
    // Transition back to normal state
    // Add some utility functions for direct state control if needed
    setIntense: function() {
      config.effectState = "intense";
      config.transitionProgress = 1;
      updateCurrentParameters();
    },
    setNormal: function() {
      config.effectState = "normal";
      config.transitionProgress = 0;
      updateCurrentParameters();
    }
  };
  const darkModeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  darkModeMediaQuery.addEventListener("change", updateMode);
  isDarkMode = darkModeMediaQuery.matches;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      cancelAnimationFrame(animationFrameId);
    } else {
      lastFrameTime = performance.now();
      animationFrameId = requestAnimationFrame(drawStatic);
    }
  });
});
//# sourceMappingURL=static-background.js.map
