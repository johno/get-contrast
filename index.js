var rgb = require('rgb');
var wcag = require('wcag-contrast');
var isBlank = require('is-blank');
var isNamedCssColor = require('is-named-css-color');
var cssColorNames = require('css-color-names');

module.exports.ratio = ratio;
module.exports.score = score;
module.exports.isAccessible = isAccessible;
module.exports.isNotTransparent = isNotTransparent;

function ratio(colorOne, colorTwo) {
  colorOne = getRgbTriplet(colorOne);
  colorTwo = getRgbTriplet(colorTwo);

  return wcag.rgb(colorOne, colorTwo);
}

function score(colorOne, colorTwo) {
  var wcagScore = wcag.score(ratio(colorOne, colorTwo));

  if (isBlank(wcagScore)) {
    return 'F';
  } else {
    return wcagScore;
  }
}

function isAccessible(colorOne, colorTwo) {
  return ratio(colorOne, colorTwo) > 4.5;
}

function getRgbTriplet(color) {
  if (typeof color != 'string') {
    throw new TypeError('get-contrast expects colors as strings');
  }

  if (isNamedCssColor(color)) {
    color = cssColorNames[color];
  }

  color = isNotTransparent(color);
  return color.match(/\((.*)\)/)[1].split(',').slice(0, 3);
}

function isNotTransparent(color) {
  // Convert to RGB.
  color = rgb(color);
  // Check if the rgb returned color is rgba and if the 'a' value is 0.
  var cArray = color.match(/\((.*)\)/)[1].split(',');
  if (cArray.length == 4 && cArray[3] == '0') {
    throw new TypeError('get-contrast cannot contrast transparent colors');
  } else {
    return color;
  }
}
