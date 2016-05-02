var assert = require('assert');
var contrast = require('..');

describe('ratio', function() {

  it('should calculate the correct ratio', function() {
    assert.equal(Math.round(contrast.ratio('#fafafa', 'rgba(0,0,0,.75)')), 20);
  });

  it('should be able to handle named CSS colors', function() {
    assert.ok(contrast.ratio('tomato', 'rebeccapurple'));
  });
});

describe('score', function() {

  it('should calculate the correct WCAG score', function() {
    assert.equal(contrast.score('#fafafa', 'rgba(0,0,0,.75)'), 'AAA');
  });

  it('should calculate the correct WCAG score', function() {
    assert.equal(contrast.score('#fafafa', '#fff'), 'F');
  });
});

describe('isAccessible', function() {

  it('should determine that a contrast is inaccessible when the ratio is below 4.5:1', function() {
    assert.equal(contrast.isAccessible('#fafafa', '#fff'), false);
  });

  it('should determine that a contrast is accesible when the ratio is above 4.5:1', function() {
    assert.ok(contrast.isAccessible('#fafafa', 'rgba(0,0,0,.75)'));
  });
});

describe('getRgbTriplet', function() {

  it('should throw an error when not given a string', function() {
    assert.throws(contrast.ratio);
  });
});

describe('isNotTransparent', function() {
  it('should throw an error when one or more color is transparent', function() {
    // Several test assertions for different styles of 'transparent'.
    assert.throws(function() {
      // Transparent white rgba.
      contrast.isNotTransparent('rgba(255,255,255,0)');
    },
    /get-contrast cannot contrast transparent colors/);
    // Transparent hsl.
    assert.throws(function() {
      contrast.isNotTransparent('hsl(100,100,100,0)');
    },
    /get-contrast cannot contrast transparent colors/);
    // Transparent named color.
    assert.throws(function() {
      contrast.isNotTransparent('transparent');
    },
    /get-contrast cannot contrast transparent colors/);
    // Transparent hex.
    assert.throws(function() {
      contrast.isNotTransparent('#FFFFFF00');
    },
    /get-contrast cannot contrast transparent colors/);
  });
});
