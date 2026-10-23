# WPT color fixtures

`wpt-color.json` holds parsing/computed-value cases from the CSS Color tests in
[web-platform-tests](https://github.com/web-platform-tests/wpt/tree/5af3c135c9c97381733866150a7ada27d1029c50/css/css-color/parsing)
(commit `5af3c135c9c97381733866150a7ada27d1029c50`), which encode browser
behavior for CSS Color 4. web-platform-tests is licensed under the 3-Clause BSD
License (https://github.com/web-platform-tests/wpt/blob/master/LICENSE.md).
Copyright (c) web-platform-tests contributors.

Rows are `[kind, input, expected | null, file]` with kind `valid`, `invalid`
or `computed`. `color-computed-hsl` is sampled (every 10th row) to keep the file
small. `extract.js` regenerates the file from downloaded copies of the sources;
the test suite never touches the network.
