
/*
 *  Common functions/variables shared by both bin/bunyan and lib/bunyan.js
 */

var VERSION = '0.21.5';

// Bunyan log format version. This becomes the 'v' field on all log records.
// `0` is until I release a version '1.0.0' of node-bunyan. Thereafter,
// starting with `1`, this will be incremented if there is any backward
// incompatible change to the log record format. Details will be in
// 'CHANGES.md' (the change log).
var LOG_VERSION = 0;

module.exports.VERSION = VERSION;
module.exports.LOG_VERSION = LOG_VERSION;

var util = require('util');

/*
 *  Fallback for util.format for node.js < 0.6
 */

var format = util.format;
if (!format) {
    // If node < 0.6, then use its `util.format`:
    // <https://github.com/joyent/node/blob/master/lib/util.js#L22>:
    var inspect = util.inspect;
    var formatRegExp = /%[sdj%]/g;
    format = function format(f) {
        if (typeof (f) !== 'string') {
            var objects = [];
            for (var i = 0; i < arguments.length; i++) {
                objects.push(inspect(arguments[i]));
            }
            return objects.join(' ');
        }

        var i = 1;
        var args = arguments;
        var len = args.length;
        var str = String(f).replace(formatRegExp, function (x) {
            if (i >= len)
                return x;
            switch (x) {
                case '%s': return String(args[i++]);
                case '%d': return Number(args[i++]);
                case '%j': return JSON.stringify(args[i++], safeCycles());
                case '%%': return '%';
                default:
                    return x;
            }
        });
        for (var x = args[i]; i < len; x = args[++i]) {
            if (x === null || typeof (x) !== 'object') {
                str += ' ' + x;
            } else {
                str += ' ' + inspect(x);
            }
        }
        return str;
    };
}

module.exports.format = format;

/*
 *  Formatting functions
 */

function formatRecord(rec, line, opts, stylize) {
    var short = false;

    switch (opts.outputMode) {
    case OM_SHORT:
        short = true;
        /* jsl:fall-thru */

    case OM_LONG:
        //    [time] LEVEL: name[/comp]/pid on hostname (src): msg* (extras...)
        //        msg*
        //        --
        //        long and multi-line extras
        //        ...
        // If 'msg' is single-line, then it goes in the top line.
        // If 'req', show the request.
        // If 'res', show the response.
        // If 'err' and 'err.stack' then show that.

        delete rec.v;

        /*
         * We assume the Date is formatted according to ISO8601, in which
         * case we can safely chop off the date information.
         */
        if (short && rec.time[10] == 'T') {
            var time = rec.time.substr(11);
            time = stylize(time, 'XXX');
        } else {
            var time = stylize('[' + rec.time + ']', 'XXX');
        }

        delete rec.time;

        var nameStr = rec.name;
        delete rec.name;

        if (rec.component) {
            nameStr += '/' + rec.component;
        }
        delete rec.component;

        if (!short)
            nameStr += '/' + rec.pid;
        delete rec.pid;

        var level = (upperPaddedNameFromLevel[rec.level] || 'LVL' + rec.level);
        if (opts.color) {
            var colorFromLevel = {
                10: 'grey',     // TRACE
                20: 'grey',     // DEBUG
                30: 'cyan',     // INFO
                40: 'magenta',  // WARN
                50: 'red',      // ERROR
                60: 'inverse',  // FATAL
            };
            level = stylize(level, colorFromLevel[rec.level]);
        }
        delete rec.level;

        var src = '';
        if (rec.src && rec.src.file) {
            var s = rec.src;
            if (s.func) {
                src = format(' (%s:%d in %s)', s.file, s.line, s.func);
            } else {
                src = format(' (%s:%d)', s.file, s.line);
            }
            src = stylize(src, 'green');
        }
        delete rec.src;

        var hostname = rec.hostname;
        delete rec.hostname;

        var extras = [];
        var details = [];

        if (rec.req_id) {
            extras.push('req_id=' + rec.req_id);
        }
        delete rec.req_id;

        var onelineMsg;
        if (rec.msg.indexOf('\n') !== -1) {
            onelineMsg = '';
            details.push(indent(stylize(rec.msg, 'cyan')));
        } else {
            onelineMsg = ' ' + stylize(rec.msg, 'cyan');
        }
        delete rec.msg;

        if (rec.req && typeof (rec.req) === 'object') {
            var req = rec.req;
            delete rec.req;
            var headers = req.headers;
            var s = format('%s %s HTTP/%s%s', req.method,
                req.url,
                req.httpVersion || '1.1',
                (headers ?
                    '\n' + Object.keys(headers).map(function (h) {
                        return h + ': ' + headers[h];
                    }).join('\n') :
                    '')
            );
            delete req.url;
            delete req.method;
            delete req.httpVersion;
            delete req.headers;
            if (req.body) {
                s += '\n\n' + (typeof (req.body) === 'object'
                    ? JSON.stringify(req.body, null, 2) : req.body);
                delete req.body;
            }
            if (req.trailers && Object.keys(req.trailers) > 0) {
                s += '\n' + Object.keys(req.trailers).map(function (t) {
                    return t + ': ' + req.trailers[t];
                }).join('\n');
            }
            delete req.trailers;
            details.push(indent(s));
            // E.g. for extra 'foo' field on 'req', add 'req.foo' at
            // top-level. This *does* have the potential to stomp on a
            // literal 'req.foo' key.
            Object.keys(req).forEach(function (k) {
                rec['req.' + k] = req[k];
            })
        }

        if (rec.client_req && typeof (rec.client_req) === 'object') {
            var client_req = rec.client_req;
            delete rec.client_req;
            var headers = client_req.headers;
            var hostHeaderLine = '';
            var s = '';
            if (client_req.address) {
                hostHeaderLine = 'Host: ' + client_req.address;
                if (client_req.port)
                    hostHeaderLine += ':' + client_req.port;
                hostHeaderLine += '\n';
            }
            delete client_req.headers;
            delete client_req.address;
            delete client_req.port;
            s += format('%s %s HTTP/%s\n%s%s', client_req.method,
                client_req.url,
                client_req.httpVersion || '1.1',
                hostHeaderLine,
                (headers ?
                    Object.keys(headers).map(
                        function (h) {
                            return h + ': ' + headers[h];
                        }).join('\n') :
                    ''));
            delete client_req.method;
            delete client_req.url;
            delete client_req.httpVersion;
            if (client_req.body) {
                s += '\n\n' + (typeof (client_req.body) === 'object' ?
                    JSON.stringify(client_req.body, null, 2) :
                    client_req.body);
                delete client_req.body;
            }
            // E.g. for extra 'foo' field on 'client_req', add
            // 'client_req.foo' at top-level. This *does* have the potential
            // to stomp on a literal 'client_req.foo' key.
            Object.keys(client_req).forEach(function (k) {
                rec['client_req.' + k] = client_req[k];
            })
            details.push(indent(s));
        }

        function _res(res) {
            var s = '';
            if (res.header) {
                s += res.header.trimRight();
            } else if (res.headers) {
                if (res.statusCode) {
                    s += format('HTTP/1.1 %s %s\n', res.statusCode,
                        http.STATUS_CODES[res.statusCode]);
                }
                var headers = res.headers;
                s += Object.keys(headers).map(
                    function (h) { return h + ': ' + headers[h]; }).join('\n');
            }
            delete res.header;
            delete res.headers;
            delete res.statusCode;
            if (res.body) {
                s += '\n\n' + (typeof (res.body) === 'object'
                    ? JSON.stringify(res.body, null, 2) : res.body);
                delete res.body;
            }
            if (res.trailer) {
                s += '\n' + res.trailer;
            }
            delete res.trailer;
            if (s) {
                details.push(indent(s));
            }
            // E.g. for extra 'foo' field on 'res', add 'res.foo' at
            // top-level. This *does* have the potential to stomp on a
            // literal 'res.foo' key.
            Object.keys(res).forEach(function (k) {
                rec['res.' + k] = res[k];
            });
        }

        if (rec.res && typeof (rec.res) === 'object') {
            _res(rec.res);
            delete rec.res;
        }
        if (rec.client_res && typeof (rec.client_res) === 'object') {
            _res(rec.client_res);
            delete rec.res;
        }

        if (rec.err && rec.err.stack) {
            details.push(indent(rec.err.stack));
            delete rec.err;
        }

        var leftover = Object.keys(rec);
        for (var i = 0; i < leftover.length; i++) {
            var key = leftover[i];
            var value = rec[key];
            var stringified = false;
            if (typeof (value) !== 'string') {
                value = JSON.stringify(value, null, 2);
                stringified = true;
            }
            if (value.indexOf('\n') !== -1 || value.length > 50) {
                details.push(indent(key + ': ' + value));
            } else if (!stringified && (value.indexOf(' ') != -1 ||
                value.length === 0))
            {
                extras.push(key + '=' + JSON.stringify(value));
            } else {
                extras.push(key + '=' + value);
            }
        }

        extras = stylize(
            (extras.length ? ' (' + extras.join(', ') + ')' : ''), 'grey');
        details = stylize(
            (details.length ? details.join('\n    --\n') + '\n' : ''), 'grey');
        if (!short)
            return format('%s %s: %s on %s%s:%s%s\n%s',
                time,
                level,
                nameStr,
                hostname || '<no-hostname>',
                src,
                onelineMsg,
                extras,
                details);
        else
            return format('%s %s %s:%s%s\n%s',
                time,
                level,
                nameStr,
                onelineMsg,
                extras,
                details);
        break;

    case OM_INSPECT:
        return util.inspect(rec, false, Infinity, true) + '\n';
        break;

    case OM_BUNYAN:
        return JSON.stringify(rec, null, 0) + '\n';
        break;

    case OM_JSON:
        return JSON.stringify(rec, null, opts.jsonIndent) + '\n';
        break;

    case OM_SIMPLE:
        /* JSSTYLED */
        // <http://logging.apache.org/log4j/1.2/apidocs/org/apache/log4j/SimpleLayout.html>
        return format('%s - %s\n',
            upperNameFromLevel[rec.level] || 'LVL' + rec.level,
            rec.msg);
        break;
    default:
        throw new Error('unknown output mode: '+opts.outputMode);
    }
}

module.exports.formatRecord = formatRecord;
