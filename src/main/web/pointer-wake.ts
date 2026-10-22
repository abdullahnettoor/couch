/**
 * Page script source (a function expression): moves a synthetic pointer a little over the middle
 * of the page, `step` choosing where. Sites that draw their controls only while the pointer moves
 * (Netflix's player bar) show them for it; call it with a new `step` each time to keep them up.
 * Shared by the host's page scripts and the page focus, so both wake the page the same way.
 */
export const WAKE_POINTER_SOURCE = `function (step) {
  var cx = innerWidth / 2, cy = innerHeight / 2;
  var t = document.elementFromPoint(cx, cy) || document.body;
  if (!t || !t.dispatchEvent) return;
  var Pointer = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
  var x = cx + (step % 12) * 7, y = cy + (step % 7) * 5;
  ['pointerover', 'pointermove', 'mouseover', 'mousemove'].forEach(function (n) {
    var C = n.indexOf('pointer') === 0 ? Pointer : MouseEvent;
    t.dispatchEvent(new C(n, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, screenX: x, screenY: y, movementX: 7, movementY: 5 }));
  });
}`;
