'use strict';

import DataTypes from './data-types';
import * as SqlString from './sql-string';
import * as _ from 'lodash';
import * as parameterValidator from './utils/parameter-validator';
import {Logger} from './utils/logger';
import * as uuid from 'uuid';
import operators from './operators';
import promise from './promise';
import * as Inflection from 'inflection';

let inflection = Inflection;
const logger = new Logger(null);
const operatorsArray = Object.values(operators);
const primitives = ['string', 'number', 'boolean'];

export const Promise = promise;
export const debug = logger.debug.bind(logger);
export const deprecate = logger.deprecate.bind(logger);
export const warn = logger.warn.bind(logger);
export const getLogger = () =>  logger ;
export const validateParameter = parameterValidator;

export function useInflection(_inflection) {
  inflection = _inflection;
}

export function camelizeIf(str, condition) {
  let result = str;

  if (condition) {
    result = camelize(str);
  }

  return result;
}

export function underscoredIf(str, condition) {
  let result = str;

  if (condition) {
    result = underscore(str);
  }

  return result;
}

export function isPrimitive(val) {
  return primitives.indexOf(typeof val) !== -1;
}

// Same concept as _.merge, but don't overwrite properties that have already been assigned
export function mergeDefaults(a, b) {
  return _.mergeWith(a, b, objectValue => {
    // If it's an object, let _ handle it this time, we will be called again for each property
    if (!_.isPlainObject(objectValue) && objectValue !== undefined) {
      return objectValue;
    }
  });
}

// An alternative to _.merge, which doesn't clone its arguments
// Cloning is a bad idea because options arguments may contain references to sequelize
// models - which again reference database libs which don't like to be cloned (in particular pg-native)
export function merge(object, options) {
  const result = {};

  for (const obj of arguments) {
    _.forOwn(obj, (value, key) => {
      if (typeof value !== 'undefined') {
        if (!result[key]) {
          result[key] = value;
        } else if (_.isPlainObject(value) && _.isPlainObject(result[key])) {
          result[key] = merge(result[key], value);
        } else if (Array.isArray(value) && Array.isArray(result[key])) {
          result[key] = value.concat(result[key]);
        } else {
          result[key] = value;
        }
      }
    });
  }

  return result;
}

export function lowercaseFirst(s) {
  return s[0].toLowerCase() + s.slice(1);
}

export function uppercaseFirst(s) {
  return s[0].toUpperCase() + s.slice(1);
}

export function spliceStr(str, index, count, add) {
  return str.slice(0, index) + add + str.slice(index + count);
}

export function camelize(str) {
  return str.trim().replace(/[-_\s]+(.)?/g, (match, c) => c.toUpperCase());
}

export function underscore(str) {
  return inflection.underscore(str);
}

export function format(arr, dialect?) {
  const timeZone = null;
  // Make a clone of the array beacuse format modifies the passed args
  return SqlString.format(arr[0], arr.slice(1), timeZone, dialect);
}

export function formatNamedParameters(sql, parameters, dialect) {
  const timeZone = null;
  return SqlString.formatNamedParameters(sql, parameters, timeZone, dialect);
}

export function cloneDeep(obj) {
  obj = obj || {};
  return _.cloneDeepWith(obj, elem => {
    // Do not try to customize cloning of arrays or POJOs
    if (Array.isArray(elem) || _.isPlainObject(elem)) {
      return undefined;
    }

    // Don't clone stuff that's an object, but not a plain one - fx example sequelize models and instances
    if (typeof elem === 'object') {
      return elem;
    }

    // Preserve special data-types like `fn` across clones. _.get() is used for checking up the prototype chain
    if (elem && typeof elem.clone === 'function') {
      return elem.clone();
    }
  });
}

/* Expand and normalize finder options */
export function mapFinderOptions(options, Model) {
  if (Model._hasVirtualAttributes && Array.isArray(options.attributes)) {
    for (const attribute of options.attributes) {
      if (Model._isVirtualAttribute(attribute) && Model.rawAttributes[attribute].type.fields) {
        options.attributes = options.attributes.concat(Model.rawAttributes[attribute].type.fields);
      }
    }
    options.attributes = _.without.apply(_, [options.attributes].concat(Model._virtualAttributes));
    options.attributes = _.uniq(options.attributes);
  }

  mapOptionFieldNames(options, Model);

  return options;
}

/* Used to map field names in attributes and where conditions */
export function mapOptionFieldNames(options, Model) {
  if (Array.isArray(options.attributes)) {
    options.attributes = options.attributes.map(attr => {
      // Object lookups will force any variable to strings, we don't want that for special objects etc
      if (typeof attr !== 'string') return attr;
      // Map attributes to aliased syntax attributes
      if (Model.rawAttributes[attr] && attr !== Model.rawAttributes[attr].field) {
        return [Model.rawAttributes[attr].field, attr];
      }
      return attr;
    });
  }

  if (options.where && _.isPlainObject(options.where)) {
    options.where = mapWhereFieldNames(options.where, Model);
  }

  return options;
}

export function mapWhereFieldNames(attributes, Model) {
  if (attributes) {
    getComplexKeys(attributes).forEach(attribute => {
      const rawAttribute = Model.rawAttributes[attribute];

      if (rawAttribute && rawAttribute.field !== rawAttribute.fieldName) {
        attributes[rawAttribute.field] = attributes[attribute];
        delete attributes[attribute];
      }

      if (_.isPlainObject(attributes[attribute])
        && !(rawAttribute && (
          rawAttribute.type instanceof DataTypes.HSTORE
          || rawAttribute.type instanceof DataTypes.JSON))) { // Prevent renaming of HSTORE & JSON fields
        attributes[attribute] = mapOptionFieldNames({
          where: attributes[attribute]
        }, Model).where;
      }

      if (Array.isArray(attributes[attribute])) {
        attributes[attribute] = attributes[attribute].map(where => {
          if (_.isPlainObject(where)) {
            return mapWhereFieldNames(where, Model);
          }

          return where;
        });
      }

    });
  }

  return attributes;
}

/* Used to map field names in values */
export function mapValueFieldNames(dataValues, fields, Model) {
  const values = {};

  for (const attr of fields) {
    if (dataValues[attr] !== undefined && !Model._isVirtualAttribute(attr)) {
      // Field name mapping
      if (Model.rawAttributes[attr] && Model.rawAttributes[attr].field && Model.rawAttributes[attr].field !== attr) {
        values[Model.rawAttributes[attr].field] = dataValues[attr];
      } else {
        values[attr] = dataValues[attr];
      }
    }
  }

  return values;
}

export function isColString(value) {
  return typeof value === 'string' && value.substr(0, 1) === '$' && value.substr(value.length - 1, 1) === '$';
}

export function argsArePrimaryKeys(args, primaryKeys) {
  let result = args.length === Object.keys(primaryKeys).length;
  if (result) {
    _.each(args, arg => {
      if (result) {
        if (['number', 'string'].indexOf(typeof arg) !== -1) {
          result = true;
        } else {
          result = arg instanceof Date || Buffer.isBuffer(arg);
        }
      }
    });
  }
  return result;
}

export function canTreatArrayAsAnd(arr) {
  return arr.reduce((treatAsAnd, arg) => {
    if (treatAsAnd) {
      return treatAsAnd;
    } else {
      return _.isPlainObject(arg);
    }
  }, false);
}

export function combineTableNames(tableName1, tableName2) {
  return tableName1.toLowerCase() < tableName2.toLowerCase() ? tableName1 + tableName2 : tableName2 + tableName1;
}

export function singularize(str) {
  return inflection.singularize(str);
}

export function pluralize(str) {
  return inflection.pluralize(str);
}

export function removeCommentsFromFunctionString(s) {
  s = s.replace(/\s*(\/\/.*)/g, '');
  s = s.replace(/(\/\*[\n\r\s\S]*?\*\/)/mg, '');

  return s;
}

export function toDefaultValue(value, dialect?) {
  if (typeof value === 'function') {
    const tmp = value();
    if (tmp instanceof DataTypes.ABSTRACT) {
      return tmp.toSql();
    } else {
      return tmp;
    }
  } else if (value instanceof DataTypes.UUIDV1) {
    return uuid.v1();
  } else if (value instanceof DataTypes.UUIDV4) {
    return uuid.v4();
  } else if (value instanceof DataTypes.NOW) {
    return now(dialect);
  } else if (_.isPlainObject(value) || _.isArray(value)) {
    return _.clone(value);
  } else {
    return value;
  }
}

/**
 * Determine if the default value provided exists and can be described
 * in a db schema using the DEFAULT directive.
 *
 * @param  {*} value Any default value.
 * @return {boolean} yes / no.
 * @private
 */
export function defaultValueSchemable(value) {
  if (typeof value === 'undefined') { return false; }

  // TODO this will be schemable when all supported db
  // have been normalized for this case
  // if (value instanceof DataTypes.NOW) { return false; }

  if (value instanceof DataTypes.UUIDV1 || value instanceof DataTypes.UUIDV4) { return false; }

  if (_.isFunction(value)) {
    return false;
  }

  return true;
}

export function removeNullValuesFromHash(hash, omitNull, options?) {
  let result = hash;

  options = options || {};
  options.allowNull = options.allowNull || [];

  if (omitNull) {
    const _hash = {};

    _.forIn(hash, (val, key) => {
      if (options.allowNull.indexOf(key) > -1 || key.match(/Id$/) || val !== null && val !== undefined) {
        _hash[key] = val;
      }
    });

    result = _hash;
  }

  return result;
}

export function stack() {
  const orig = Error.prepareStackTrace;
  Error.prepareStackTrace = (_, stack) => stack;
  const err = new Error();
  Error.captureStackTrace(err, stack);
  const errStack = err.stack;
  Error.prepareStackTrace = orig;
  return errStack;
}

export function sliceArgs(args, begin?) {
  begin = begin || 0;
  const tmp = new Array(args.length - begin);
  for (let i = begin; i < args.length; ++i) {
    tmp[i - begin] = args[i];
  }
  return tmp;
}

export function now(dialect) {
  const now = new Date();
  if (['mysql', 'postgres', 'sqlite', 'mssql', 'oracle'].indexOf(dialect) === -1) {
    now.setMilliseconds(0);
  }
  return now;
}

// Note: Use the `quoteIdentifier()` and `escape()` methods on the
// `QueryInterface` instead for more portable code.

export const TICK_CHAR = '`';

export function addTicks(s, tickChar) {
  tickChar = tickChar || TICK_CHAR;
  return tickChar + removeTicks(s, tickChar) + tickChar;
}

export function removeTicks(s, tickChar?) {
  tickChar = tickChar || TICK_CHAR;
  return s.replace(new RegExp(tickChar, 'g'), '');
}

/**
 * Receives a tree-like object and returns a plain object which depth is 1.
 *
 * - Input:
 *
 *  {
 *    name: 'John',
 *    address: {
 *      street: 'Fake St. 123',
 *      coordinates: {
 *        longitude: 55.6779627,
 *        latitude: 12.5964313
 *      }
 *    }
 *  }
 *
 * - Output:
 *
 *  {
 *    name: 'John',
 *    address.street: 'Fake St. 123',
 *    address.coordinates.latitude: 55.6779627,
 *    address.coordinates.longitude: 12.5964313
 *  }
 *
 * @param value, an Object
 * @return Object, an flattened object
 * @private
 */
export function flattenObjectDeep(value) {
  if (!_.isPlainObject(value)) return value;

  function flattenObject(obj, flattenedObj = {}, subPath?) {
    Object.keys(obj).forEach(key => {
      const pathToProperty = subPath ? `${subPath}.${key}` : `${key}`;
      if (typeof obj[key] === 'object') {
        flattenObject(obj[key], flattenedObj, pathToProperty);
      } else {
        flattenedObj[pathToProperty] = _.get(obj, key);
      }
    });
    return flattenedObj;
  }

  return flattenObject(value);
}

/**
 * Utility functions for representing SQL functions, and columns that should be escaped.
 * Please do not use these functions directly, use Sequelize.fn and Sequelize.col instead.
 * @private
 */
export class SequelizeMethod {}

export class Fn extends SequelizeMethod {
  fn;
  args;
  constructor(fn, args) {
    super();
    this.fn = fn;
    this.args = args;
  }
  clone() {
    return new Fn(this.fn, this.args);
  }
}

export class Col extends SequelizeMethod {
  col;
  constructor(col) {
    super();
    if (arguments.length > 1) {
      col = sliceArgs(arguments);
    }
    this.col = col;
  }
}

export class Cast extends SequelizeMethod {
  val;
  type;
  json;
  constructor(val, type, json?) {
    super();
    this.val = val;
    this.type = (type || '').trim();
    this.json = json || false;
  }
}

export class Literal extends SequelizeMethod {
  val;
  constructor(val) {
    super();
    this.val = val;
  }
}

export class Json extends SequelizeMethod {
  conditions;
  path;
  value;
  constructor(conditionsOrPath, value?) {
    super();
    if (_.isObject(conditionsOrPath)) {
      this.conditions = conditionsOrPath;
    } else {
      this.path = conditionsOrPath;
      if (value) {
        this.value = value;
      }
    }
  }
}

export class Where extends SequelizeMethod {
  attribute;
  comparator;
  logic;
  constructor(attribute, comparator, logic) {
    super();
    if (logic === undefined) {
      logic = comparator;
      comparator = '=';
    }

    this.attribute = attribute;
    this.comparator = comparator;
    this.logic = logic;
  }
}


export function mapIsolationLevelStringToTedious (isolationLevel, tedious) {
  if (!tedious) {
    throw new Error('An instance of tedious lib should be passed to this function');
  }
  const tediousIsolationLevel = tedious.ISOLATION_LEVEL;
  switch (isolationLevel) {
    case 'READ_UNCOMMITTED':
      return tediousIsolationLevel.READ_UNCOMMITTED;
    case 'READ_COMMITTED':
      return tediousIsolationLevel.READ_COMMITTED;
    case 'REPEATABLE_READ':
      return tediousIsolationLevel.REPEATABLE_READ;
    case 'SERIALIZABLE':
      return tediousIsolationLevel.SERIALIZABLE;
    case 'SNAPSHOT':
      return tediousIsolationLevel.SNAPSHOT;
  }
};

//Collection of helper methods to make it easier to work with symbol operators

/**
 * getOperators
 * @param  {Object} obj
 * @return {Array<Symbol>} All operators properties of obj
 * @private
 */
export function getOperators(obj) {
  return _.intersection(Object.getOwnPropertySymbols(obj || {}), operatorsArray);
}

/**
 * getComplexKeys
 * @param  {Object} obj
 * @return {Array<String|Symbol>} All keys including operators
 * @private
 */
export function getComplexKeys(obj) {
  return getOperators(obj).concat(_.keys(obj));
}

/**
 * getComplexSize
 * @param  {Object|Array} obj
 * @return {Integer}      Length of object properties including operators if obj is array returns its length
 * @private
 */
export function getComplexSize(obj) {
  return Array.isArray(obj) ? obj.length : getComplexKeys(obj).length;
}

/**
 * Returns true if a where clause is empty, even with Symbols
 *
 * @param  {Object} obj
 * @return {Boolean}
 * @private
 */
export function isWhereEmpty(obj) {
  return _.isEmpty(obj) && getOperators(obj).length === 0;
}

/**
 * Returns ENUM name by joining table and column name
 *
 * @param {String} tableName
 * @param {String} columnName
 * @return {String}
 * @private
 */
export function generateEnumName(tableName, columnName) {
  return 'enum_' + tableName + '_' + columnName;
}

/**
 * Returns an new Object which keys are camelized
 * @param {Object} obj
 * @return {String}
 * @private
 */
export function camelizeObjectKeys(obj) {
  const newObj = new Object();
  Object.keys(obj).forEach(key => {
    newObj[camelize(key)] = obj[key];
  });
  return newObj;
}

