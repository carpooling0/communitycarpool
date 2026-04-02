(function () {
  var id = (typeof UMAMI_WEBSITE_ID !== 'undefined')
    ? UMAMI_WEBSITE_ID
    : (location.hostname === 'dev.communitycarpool.org'
        ? '9d08c539-686d-47f8-87b6-bb4ff63f5c17'
        : '95b6c0b0-6a71-42ea-8f2d-56ec5eb5e55a')
  var s = document.createElement('script')
  s.defer = true
  s.src = 'https://cloud.umami.is/script.js'
  s.setAttribute('data-website-id', id)
  document.head.appendChild(s)
})()
