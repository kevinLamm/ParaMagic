Place the browser build of OpenCV.js here as `opencv.js`.

The image warp tool first attempts to load:

```text
public/vendor/opencv.js
```

If the file is not present, the app falls back to its built-in JavaScript perspective warp implementation.
