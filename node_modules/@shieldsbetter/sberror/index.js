'use strict';

const Mustache = require('mustache');
Mustache.escape = text => text;

const camelCase = require('camel-case');
const constantCase = require('constant-case');

const topSecret = new Object();

class SBError extends Error {
    constructor(shouldBeTopSecret, msg) {
        if (shouldBeTopSecret !== topSecret) {
            throw buildAbstractError('SBError');
        }

        super(msg);
    }
}

class CannotInstantiateAbstract extends SBError {
    constructor(abstractTypeName) {
        super(topSecret, `${abstractTypeName} is an abstract error type and ` +
                `cannot be instantiated directly.  Use subtype() to make a ` +
                `concrete subtype.`);
        
        this.code = 'CANNOT_INSTANTIATE_ABSTRACT';
        this.cannotInstantiateAbstract = true;
    }
};

// This just allows a forward reference to creating CannotInstantiateAbstract
// error instances.
function buildAbstractError(abstractTypeName) {
    return new CannotInstantiateAbstract(abstractTypeName);
}

module.exports = SBError;

module.exports.subtype = subtyper(SBError);

module.exports.CannotInstantiateAbstract = CannotInstantiateAbstract;
module.exports.DefaultSwitchCase = SBError.subtype('DefaultSwitchCase',
        'No switch match for thrown value "{{thrownValue}}" with prototype ' +
        '"{{thrownValuePrototypeName}}".');
module.exports.ThrownValueWasNullOrUndefined = SBError.subtype(
        'ThrownValueWasNullOrUndefined',
        'Thrown value was {{thrownValueToString}}.');
module.exports.UnexpectedType = SBError.subtype(
        'UnexpectedType',
        'Expected {{valueName}} to be type {{expectedTypeDescription}}, but ' +
        'value was {{value}}, of type {{valueType}}.');
module.exports.BadOptions = SBError.subtype(
		'BadOptions', 'Provided options were unacceptable.  {{reason}}');

module.exports.switch = (error, cases, defaultFn) => {
    if (error === undefined || error === null) {
        throw new module.exports.ThrownValueWasNullOrUndefined({
            thrownValue: error,
            thrownValueToString: '' + error
        });
    }

    if (!defaultFn) {
        defaultFn = () => {
            let thrownValuePrototypeName;
            if (error.constructor) {
                thrownValuePrototypeName = error.constructor.name;
            }

            if (!thrownValuePrototypeName) {
                thrownValuePrototypeName = '[Unknown]';
            }
        
            throw new module.exports.DefaultSwitchCase({
                thrownValue: error,
                thrownValuePrototypeName: thrownValuePrototypeName
            }, error);
        };
    }
    
    let level = error;
    let toCall;
    while (!toCall && level) {
        if (level.constructor) {
            let levelTypeName = level.constructor.name;
            if (levelTypeName) {
                toCall = cases[levelTypeName];
                
                if (!toCall && levelTypeName === 'Object') {
                    toCall = defaultFn;
                }
            }
        }
        
        level = Object.getPrototypeOf(level);
    }
    
    if (!toCall) {
        toCall = defaultFn;
    }
    
    return toCall(error);
}

function subtyper(ParentClass, parentOptions) {
	parentOptions = parentOptions || {};

    return (name, options) => {
		options = options || {};
		if (typeof options === 'string') {
			options = { template: options };
		}
		
		options.templater = options.templater || parentOptions.templater ||
				Mustache.render;
		
        const result = class extends ParentClass {
            constructor(details, cause) {
                let message;

                if (details === topSecret) {
                    // We're being provided our literal message via private
                    // call.
                    message = cause;
                }
                else {
                    // This is a normal public constructor call.
                    
                    if (!options.template) {
                        throw buildAbstractError(name);
                    }
                    
                    if (details instanceof Error) {
                        cause = details;
                        details = undefined;
                    }
                    
                    message =
                    		options.templater(options.template, details || {});
                }
               
                super(topSecret, message);
                
                if (details !== topSecret) {
                    // Only do this once at the top-level public call...
                        
                    this.code = constantCase(name);
                    
                    if (details) {
                        if (typeof details === 'object') {
                            this.details = details;
                            Object.keys(details).forEach(detail => {
                                if (typeof this[detail] === 'undefined') {
                                    this[detail] = details[detail];
                                }
                            });
                        }
                        else {
                            throw new module.exports.UnexpectedType({
                                value: details,
                                valueType: typeof details,
                                expectedTypeDescription: 'object',
                                valueName: 'details parameter'
                            });
                        }
                    }
                    
                    if (cause) {
                        this.cause = cause;
                    }
                }

                this[camelCase(name)] = true;
            }
        };
        
        Object.defineProperty(result, 'name', { value: name });
        result.subtype = subtyper(result, options);
        
        return result;
    };
}
