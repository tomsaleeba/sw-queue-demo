module.exports = {
  configureWebpack: {
    entry: {
      ['sw-helper']: ['./src/sw-helper.js'],
    },
    plugins: [],
  },
}
