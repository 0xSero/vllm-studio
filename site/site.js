// OS detection: label the primary download button and mark the matching row.
(function () {
  var ua = navigator.userAgent;
  var os = /Mac/i.test(ua) ? "mac" : /Win/i.test(ua) ? "win" : /Linux|X11/i.test(ua) ? "linux" : null;
  if (!os) return;

  var labels = {
    mac: "Download for macOS (.dmg)",
    win: "Download for Windows (.exe)",
    linux: "Download for Linux (.AppImage)"
  };

  var primary = document.getElementById("download-primary");
  if (primary) primary.textContent = labels[os];

  var alt = document.getElementById("download-alt");
  if (alt) alt.textContent = "Also available for the other platforms below.";

  var row = document.querySelector('.dl-row[data-os="' + os + '"]');
  if (row) row.classList.add("is-current");
})();
