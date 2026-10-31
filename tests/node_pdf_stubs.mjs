// Browsers have DOMMatrix and Path2D; Node does not. PDF.js only needs them to draw pages, never to read text.
globalThis.DOMMatrix ??= class { constructor() { this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0; } multiplySelf() { return this; } preMultiplySelf() { return this; } translate() { return this; } scale() { return this; } invertSelf() { return this; } };
globalThis.Path2D ??= class {};
