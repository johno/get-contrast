# get-contrast

Get the contrast ratio and WCAG score for two colors based on
[W3C Accessibility Standards](http://www.w3.org/TR/WCAG20/#visual-audio-contrast-contrast).
It handles rgb, rgba, hex, hsl, hsla, and named CSS colors.

## Installation

```
npm i --save get-contrast
# yarn add get-contrast
```

## Usage

```javascript
const contrast = require("get-contrast");

contrast.ratio("#fafafa", "rgba(0,0,0,.75)"); // => 10
contrast.score("#fafafa", "rgba(0,0,0,.75)"); // => 'AAA'
contrast.isAccessible("#fafafa", "rgba(0,0,0,.75)"); // => true
contrast.isAccessible("#fafafa", "#fff"); // => false
contrast.score("rebeccapurple", "tomato"); // => 'F'
```

#### Options

- `ignoreAlpha` (default: `false`) - Don't raise an error when transparent values are passed (`rgba(0, 0, 0, 0)`)

```js
contrast.score("rgba(0, 0, 0, 0)", "rgba(255, 255, 255, 0)", {
  ignoreAlpha: true,
}); // => 'AAA'
```

## CLI

This module includes a command line interface `contrast`.

```sh
$ npm i get-contrast -g
$ contrast "#000" "#fff"
Ratio: 21
Score: AAA
# The second parameter defaults to #fff
$ contrast white
Ratio: 1
Score: F
The contrast is not accessible.
# Contrast will exit with an error code, when the values are not accessible.
$ contrast "#ff0" "#fff" && ./deploy.sh
Ratio: 1.0738392309265699
Score: F
The contrast is not accessible.
```

## Related

Uses the following packages:

- <https://github.com/tmcw/wcag-contrast>
- <https://github.com/kamicane/rgb>

Inspired by:

- <https://leaverou.github.com/contrast-ratio>

## License

MIT

## Contributing

1. Fork it
2. Create your feature branch (`git checkout -b my-new-feature`)
3. Commit your changes (`git commit -am 'Add some feature'`)
4. Push to the branch (`git push origin my-new-feature`)
5. Create new Pull Request

> Authored by [John Otander](http://johno.com) ([@4lpine](https://twitter.com/4lpine)).
