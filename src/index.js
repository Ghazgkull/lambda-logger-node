'use strict'

var assign = require('object-assign')
var objectKeys = function(o,k,r){r=[];for(k in o)r.hasOwnProperty.call(o,k)&&r.push(k);return r} // eslint-disable-line

var startTime = Date.now()
var originalLog
var originalInfo
var originalWarn
var originalError
var contextLogMapper

var minimumLogLevel = null
var logLevelPriority = ['trace', 'debug', 'info', 'warn', 'log', 'error', 'fatal']
var tokenizer = /{{(.+?)}}/g
var logFormat = 'traceId={{traceId}} {{date}} appname={{appname}} version={{version}} severity={{severity}}'
var logKeys = {}

module.exports = logModule

function logModule (handler) {
  return function (event, context, callback) {
    originalLog = console.log.bind(console)
    console.log = log
    originalInfo = console.info.bind(console)
    console.info = logRouter('info')
    originalError = console.error.bind(console)
    console.error = logRouter('error')
    originalWarn = console.warn.bind(console)
    console.warn = logRouter('warn')

    contextLogMapper = {
      'info': originalInfo,
      'warn': originalWarn,
      'error': originalError
    }

    // Create initial values from context
    setMdcKeys(event, context)

    var next = function (err, result) {
      finalLog(event, context, err, result)
      callback(err, result)
    }

    var logContext = assign({}, context, {
      succeed: function (result) {
        finalLog(event, context, null, result)
        context.succeed(result)
      },
      fail: function (error) {
        finalLog(event, context, error, null)
        context.fail(error)
      },
      done: function (error, result) {
        finalLog(event, context, error, result)
        context.done(error, result)
      }
    })

    handler(event, logContext, next)
  }
}

logModule.format = logFormat
logModule.log = log
logModule.setKey = setKey
logModule.restoreConsoleLog = restoreConsoleLog
logModule.trace = logRouter('trace')
logModule.debug = logRouter('debug')
logModule.info = logRouter('info')
logModule.warn = logRouter('warn')
logModule.error = logRouter('error')
logModule.fatal = logRouter('fatal')
logModule.setMinimumLogLevel = setMinimumLogLevel

function setKey (keyName, value) {
  logKeys[keyName] = value
}

function setMdcKeys (event, context) {
  setKey('traceId', context.awsRequestId)
  setKey('date', function () { return formatRfc3339(new Date(Date.now())) })
  setKey('appname', context.functionName)
  setKey('version', context.functionVersion)
  setKey('apigTraceId', context && context.requestContext && context.requestContext.requestId)
}

function buildAccessLogPrefix (severity) {
  var prefix = logModule.format.replace(/{{severity}}/, severity || logKeys['severity'] || 'info')
  return prefix.replace(tokenizer, getToken)
}

function getToken (match, key) {
  var token = logKeys[key] || '((TOKEN MISSING: ' + key + '))'
  return typeof token === 'function' ? token() : token
}

function restoreConsoleLog () {
  console.log = originalLog
  console.warn = originalWarn
  console.error = originalError
  console.info = originalInfo
}

function log () {
  return originalLog.apply(null, [buildAccessLogPrefix(), '|'].concat(Array.prototype.slice.call(arguments)))
}

function setMinimumLogLevel (level) {
  if (logLevelPriority.indexOf(level) === -1) {
    throw new Error('Illegal log level value: ' + level)
  }
  minimumLogLevel = level
}

function logWithSeverity (message, severity) {
  // originalLog.call(null, 'severity', severity)
  // Do not log message below the minimumLogLevel
  if (!canSeverityLog(severity)) {
    return
  }
  var contextLogger = contextLogMapper[severity] || originalLog
  return contextLogger.apply(null, [buildAccessLogPrefix(severity), '|'].concat(message))
}

function canSeverityLog (severity) {
  if (logLevelPriority.indexOf(severity) === -1) throw new Error('Unable to log, illegal severity: ' + severity)
  return !(minimumLogLevel && severity && logLevelPriority.indexOf(severity) < logLevelPriority.indexOf(minimumLogLevel))
}

function logRouter (severity) {
  return function () { logWithSeverity(Array.prototype.slice.call(arguments), severity) }
}

function finalLog (event, context, err, result) {
  var finalValues = {
    'requestURL': event.path,
    'requestMethod': event.method,
    'elapsedTime': Date.now() - startTime,
    'accessToken': event.headerParams && event.headerParams.Authorization,
    'apiKey': null,
    'restApiId': event.requestId,
    'apigTraceId': logKeys['apigTraceId'],
    'restResourceId': null,
    'result': JSON.stringify(err || result)
  }
  var logValues = []
  objectKeys(finalValues).forEach(function (key) {
    if (finalValues[key]) logValues.push(key + '=' + finalValues[key])
  })
  log.apply(null, logValues)
  restoreConsoleLog()
}

// Utilities
//

function pad (n) { return n < 10 ? '0' + n : n }

function formatRfc3339 (d) {
  return d.getUTCFullYear() + '-' +
    pad(d.getUTCMonth() + 1) + '-' +
    pad(d.getUTCDate()) + 'T' +
    pad(d.getUTCHours()) + ':' +
    pad(d.getUTCMinutes()) + ':' +
    pad(d.getUTCSeconds()) + 'Z'
}
