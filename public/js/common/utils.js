function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func.apply(this, args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}
function formatNumberCompact(n) {
  const s = Number(n).toFixed(2);
  return s.replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
}
function formatVoiceName(voice) {
  return voice.replace(/[_-]/g, " ").replace(/\b\w/g, (chr) => chr.toUpperCase());
}
export {
  debounce,
  formatNumberCompact,
  formatVoiceName
};
//# sourceMappingURL=utils.js.map
