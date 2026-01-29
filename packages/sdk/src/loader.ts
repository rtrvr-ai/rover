(function () {
  const w = window as any;
  const rover = (w.rover = w.rover || function () {
    (rover.q = rover.q || []).push(arguments);
  });
  rover.l = +new Date();
})();
