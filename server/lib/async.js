// Express 4 does not catch errors from async handlers — without this a thrown error leaves the request
// hanging forever. Wrap every async route: router.post('/x', wrap(async (req, res) => { ... })).
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
