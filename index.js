var rgb = require('rgb');
var wcag = require('wcag-contrast');
var isBlank = require('is-blank');

module.exports.ratio = ratio;
module.exports.score = score;
module.exports.isAccessible = isAccessible;

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

  return rgb(color).match(/\((.*)\)/)[1].split(',').slice(0, 3);
}
