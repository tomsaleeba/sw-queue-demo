module.exports = (() => {
  if (process.env.NODE_ENV !== 'development') {
    return {}
  }
  // we want the noop service worker that the vue pwa plugin provides so our
  // code doesn't explode due to a lack of one. Weirdly, this still works when
  // you do `NODE_ENV=production yarn serve`, but that's good as it's exactly
  // what we want.
  return {
    /* See https://github.com/vuejs/vue-cli/tree/dev/packages/%40vue/cli-plugin-pwa for more details */
    pwa: {
      workboxPluginMode: 'GenerateSW',
    },
  }
})()
