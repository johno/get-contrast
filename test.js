import test from 'ava'
import contrast from './'

test('ratio', t => {
  t.plan(2)

  t.deepEqual(Math.round(contrast.ratio('#fafafa', 'rgba(0,0,0,.75)')), 20)
  t.ok(contrast.ratio('tomato', 'rebeccapurple'))
})

test('score', t => {
  t.plan(2)

  t.deepEqual(contrast.score('#fafafa', 'rgba(0,0,0,.75)'), 'AAA')
  t.deepEqual(contrast.score('#fafafa', '#fff'), 'F')
})

test('isAccessible', t => {
  t.plan(2)

  t.false(contrast.isAccessible('#fafafa', '#fff'))
  t.true(contrast.isAccessible('#fafafa', 'rgba(0,0,0,.75)'))
})

test('isNotTransparent', t => {
  t.plan(5)

  t.throws(() => (contrast.isNotTransparent('rgba(255,255,255,0)')))
  t.throws(() => (contrast.isNotTransparent('hsl(100,100,100,0)')))
  t.throws(() => (contrast.isNotTransparent('transparent')))
  t.throws(() => (contrast.isNotTransparent('#FFFFFF00')))

  t.ok(contrast.isNotTransparent('rgba(0, 0, 0, 0)', { ignoreAlpha: true }))
})
