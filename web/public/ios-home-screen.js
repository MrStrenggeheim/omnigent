// iOS can report a Home Screen launch through its Apple-specific flag.
if (navigator.standalone === true) {
  document.documentElement.setAttribute("data-ios-standalone", "");
}
