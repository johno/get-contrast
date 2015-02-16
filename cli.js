#!/usr/bin/env node

var contrast = require('./')

if(process.argv.length <= 2) {
  console.error('usage: contrast <color1> [color2 (default: #fff)]')
  process.exit()
}

var color1 = process.argv[2] 
var color2 = process.argv[3] || '#fff'

console.log('Ratio:', contrast.ratio(color1, color2))
console.log('Score:', contrast.score(color1, color2))
if(!contrast.isAccessible(color1, color2)) {
  console.log('The contrast is not accessible.')
  process.exit(1)
}