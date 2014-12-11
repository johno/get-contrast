var assert = require('assert');
var contrast = require('..');

describe('ratio', function() {

  it('should calculate the correct ratio', function() {
    assert.equal(contrast.ratio('#fafafa', 'rgba(0,0,0,.75)'), 10);
  });
});

describe('score', function() {

  it('should calculate the correct WCAG score', function() {
    assert.equal(contrast.score('#fafafa', 'rgba(0,0,0,.75)'), 'AAA');
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
