// Shared by the command modules.
const EXIT = Object.freeze({ OK: 0, NOT_MET: 1, USAGE: 2, FAILURE: 3 });

class UsageError extends Error {
  /** @param {string} message @param {string} [code] error.code in --json output */
  constructor(message, code = "usage") {
    super(message);
    this.code = code;
  }
}

module.exports = { EXIT, UsageError };
