const _ = require('lodash');
const domain = require('domain');
const prettyjson = require('prettyjson');
const stringify = require('json-stringify-safe');

const eventFormatter = require('./event-formatter');
const isEnabled = require('./is-enabled');
const Serializer = require('./serializer');
const loggerLevels = require('./levels');
const logLevelFilter = require('./log-level-filter');

/**
 * Default options for prettyjson
 */
const PrettyJsonDefaultOptions = Object.freeze({
  defaultIndentation: 4,
  inlineArrays: 1,
});

/**
 * For development mode
 */
const prettyPrint = (event) => {
  const header = `[${event.timestamp}]: [${event.message}]`;
  const eventDetails = _.omit(event, 'timestamp', 'message');
  const body = prettyjson
    .render(eventDetails, _.clone(PrettyJsonDefaultOptions))
    .replace(/\n/g, '\n\t');

  return `\n${header}\n\t${body}\n\n`;
};

/**
 * default values for Logger instance
 * @private
 */
const DEFAULT_LOGGER_ATTRIBUTES = {
  logLevel: process.env.LOG_LEVEL || loggerLevels.error,
  logLimit: process.env.LOG_LIMIT || 7000,
  logPatterns: process.env.LOG_NAMESPACES || undefined,
  namespace: '',
};

/** @private */
function normalizeArguments(options, extraParameters) {
  if (!options) return DEFAULT_LOGGER_ATTRIBUTES;

  if (!extraParameters.length) return Object.assign({}, DEFAULT_LOGGER_ATTRIBUTES, options);

  const [namespace, logPatterns, logLimit, logLevel] = extraParameters;

  return {
    context: options,
    logLevel,
    logLimit,
    logPatterns,
    namespace,
  };
}

/**
 * Basic Logger usage
 * @example
 * const apiLogger = new Logger({
 *  context: { api: 'myAwesomeAPI' }
 *  logLevel: 'error',
 *  logLimit: 7000,
 *  logPatterns: '',
 *  namespace: ''
 * });
 *
 * apiLogger.warn('Before doing any requests check your connection')
 * apiLogger.info('GET request for 127.0.0.1/myAwesomeAPI')
 * apiLogger.error('Bad request', { errorData })
 */
class Logger {
  /**
   * Initialize a Logger instance, using prettyjson when LOGS_PRETTY_PRINT is set
   * @param {Object} options - A collection of options
   * @param {Any} [options.context=undefined] - Logger context, accepts any value type
   * @param {String} [options.logLevel='error'] - Logger level, available options:
   * debug, error, warn, log
   * @param {Number} [options.logLimit=7000] - Number in bytes for maximum size of
   * data when using `logLevel:debug`
   * @param {String} [options.logPatterns=undefined] - Pattern to log. `logPatterns: 'api,database'`
   * will match and output any log with "api" or "database" in thier namespaces
   *
   * You can also exclude specific debuggers by prefixing them with a "-" character
   * `logPatterns: 'api,-api:myAwesomeApi'`
   * @param {String} options.namespace - Logger namespace
   *
   * @param  {...any} extraParameters - DEPRECATED, Prefer usage of options object
   *
   * It's possible to create logger using the following syntax:
   *
   * `new Logger(context, namespace, logPatterns, logLimit, logLevel)`
   *
   * However, this method is deprecated prior to object options
   *
   * It will not be possible to use that method on next major release
   */
  // eslint-disable-next-line max-lines-per-function
  constructor(options, ...extraParameters) {
    const {
      context, namespace, logFormat, logPatterns, logLimit, logLevel,
    } = normalizeArguments(options, extraParameters);

    Object.assign(this, {
      contextData: { context, name: process.env.APP_NAME },
      format: process.env.LOGS_PRETTY_PRINT ? prettyPrint : stringify,
      log: this.info,
      logFormat,
      logLevel,
      logLimit,
      logPatterns,
      namespace,
      serializer: new Serializer({ context, name: process.env.APP_NAME }, namespace, logLimit),
    });
  }

  /**
   * Returns a new logger with the same contextual information and a child namespace
   * @param {string} namespace - namespace to be appended to the current one in the new instance
   *
   * `appLogger = new Logger({ namespace: 'docs', ...otherOptions }) // namespace: docs`
   *
   * `childLogger = appLogger.createChildLogger('child') // namespace: docs:child`
   *
   * @returns Logger
   */
  createChildLogger(namespace) {
    const prefix = this.namespace ? `${this.namespace}:` : '';

    const { logPatterns } = this;

    return new Logger({ context: this.contextData.context, logPatterns, namespace: `${prefix}${namespace}` });
  }

  /**
   * Logs a message using stdout
   * @param {Object} message - the message to be logged
   * @param {Object} [additionalArguments] - object with additional info to be logged
   */
  info(message, additionalArguments = {}) {
    this.output(message, additionalArguments);
  }

  /**
   * Logs level warn a message using stdout
   * @param {Object} message - the message to be logged
   * @param {Object} [additionalArguments] - object with additional info to be logged
   */
  warn(message, additionalArguments = {}) {
    this.output(message, additionalArguments, loggerLevels.warn);
  }

  /**
   * Logs level error a message using stdout
   * @param {Object} message - the message to be logged
   * @param {Object} [additionalArguments] - object with additional info to be logged
   */
  error(message, additionalArguments = {}) {
    this.output(message, additionalArguments, loggerLevels.error);
  }

  /**
   * Logs a message using stdout only if the debug mode is enabled
   * @param {Object} message - the message to be logged
   * @param {Object} [additionalArguments] - object with additional info to be logged
   */
  debug(message, additionalArguments = {}) {
    this.output(message, additionalArguments, loggerLevels.debug);
  }

  /**
   * Set sessionId on context in contextData
   *
   * It's preferable to set Logger sessionId as a context attribute upon creation
   *
   * `new Logger({ context: { sessionId: uuid(), ...otherParameters } })`
   *
   * This method will be removed on the next major release
   *
   * @param {uuid} sessionId
   * @deprecated
   */
  setSessionId(sessionId) {
    this.contextData.context = Object.assign(
      {}, this.contextData.context, { sessionId },
    );
  }

  /** @private */
  output(message, additionalArguments, outputType = loggerLevels.log) {
    if (this.shouldSuppressOutput(outputType)) return;

    const event = this.serializer.serialize(
      message, additionalArguments, outputType,
    );

    const formattedEvent = eventFormatter(event, this.logFormat);

    console.log(`${this.format(formattedEvent)}`); // eslint-disable-line no-console
  }

  /** @private */
  shouldSuppressOutput(outputType) {
    return [
      logLevelFilter({ logLevel: this.logLevel, outputType }),
      isEnabled(this.namespace, this.logPatterns),
    ].some(response => response !== true);
  }

  /**
   * Returns the current Logger instance in the active domain
   * or an instance without contextual information if there is no active domain.
   */
  static current() {
    if (!domain.active) {
      return new Logger();
    }

    return domain.active.logger;
  }
}

module.exports = Logger;
