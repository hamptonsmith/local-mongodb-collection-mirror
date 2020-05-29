const assert = require('assert');
const SBError = require('./index');

{
    const AError = SBError.subtype('AError', 'A msg');
    const BError = AError.subtype('BError', 'B msg');
    const b = new BError();

    assert.equal(b.code, 'B_ERROR', 'should have subtype name constant case');
    assert(b.bError, 'should have subtype name camel case property set');
    assert(b.aError, 'should have parent type name camel case property set');

    assert(b instanceof BError,
            'SBError subtypes should be instanceof themselves');
    assert(b instanceof AError,
            'SBError subtypes should be instanceof any parent type');
    assert(b instanceof SBError,
            'SBError subtypes should be instanceof SBError');
    assert(b instanceof Error, 'SBError subtypes should be instanceof Error');
}

{
    const cause = new Error();

    const A = SBError.subtype('A', 'A msg');
    const B = A.subtype('B', 'B msg');
    const details = {};
    const b = new B(details, cause);
    
    assert.equal(b.cause, cause, 'cause should be set as a property');
    assert.equal(b.details, details,
            'error should have reference to empty details');
}

{
    const cause = new Error();

    const A = SBError.subtype('A', 'A msg');
    const B = A.subtype('B', 'B msg');
    const b = new B(cause);
    
    assert.equal(b.cause, cause, 'cause can be provided with no details');
    assert(typeof b.details === 'undefined',
            'error built with omitted details should not have a details field');
}

{
    const A = SBError.subtype('A', 'A msg: {{aValue}}');
    const B = A.subtype('B', 'B msg: {{bValue}}');
    const details = {
        aValue: 'value a',
        bValue: 'value b'
    };
    const b = new B(details);

    assert.equal(b.message, 'B msg: value b',
            'Highest level template should be filled, but was: ' + b.message);
    assert.deepEqual([b.aValue, b.bValue], ['value a', 'value b'],
            'Details should be copied into top level error');
    assert.equal(b.details, details, 'details property should be reference ' +
            'to original details');
}

{
    try {
        const Sub = SBError.subtype('Sub', 'SubMsg');
        new Sub('these aren\'t details at all!');
    }
    catch (e) {
        assert(e instanceof SBError.UnexpectedType, 'providing non-object ' +
                'details throws an UnexpectedType error');
    }
}

{
    try {
        new SBError();
    }
    catch (e) {
        assert(e instanceof SBError.CannotInstantiateAbstract, 'attempting ' +
                'to instantiate root error should throw ' +
                'CannotInstantiateAbstract error');
    }
}

{
    try {
        const AbstractError = SBError.subtype('AbstractError');
        new AbstractError();
    }
    catch (e) {
        assert(e instanceof SBError.CannotInstantiateAbstract, 'attempting ' +
                'to instantiate abstract error should throw ' +
                'CannotInstantiateAbstract error');
    }
}

{
    const AbstractError = SBError.subtype('AbstractError');
    const ConcreteError = AbstractError.subtype('ConcreteError', 'msg');
    new ConcreteError();
}

{
    const AbstractError = SBError.subtype('AbstractError');
    const ConcreteErrorA = AbstractError.subtype('ConcreteErrorA', 'msg');
    const ConcreteErrorB = AbstractError.subtype('ConcreteErrorB', 'msg');
    
    let ranIt;
    SBError.switch(new ConcreteErrorA(), {
        ConcreteErrorA: () => {
            ranIt = true;
        },
        ConcreteErrorB: () => {
            assert.fail('switch shouldn\'t run spurious branches');
        },
        AbstractError: () => {
            assert.fail('switch shouldn\'t run parent branches when child ' +
                    'is available');
        },
        Error: () => {
            assert.fail('switch shouldn\'t run parent branches when child ' +
                    'is available');
        },
        Object: () => {
            assert.fail('switch shouldn\'t run parent branches when child ' +
                    'is available');        
        }
    });
    
    assert(ranIt, 'should run leaf branch if available');
}

{
    const AbstractError = SBError.subtype('AbstractError');
    const ConcreteErrorA = AbstractError.subtype('ConcreteErrorA', 'msg');
    const ConcreteErrorB = AbstractError.subtype('ConcreteErrorB', 'msg');
    
    let ranIt;
    SBError.switch(new ConcreteErrorA(), {
        ConcreteErrorA: () => {
            ranIt = true;
        }
    }, () => {
        assert.fail('shouldn\'t run explicit default if match is available');
    });
    
    assert(ranIt, 'should run leaf branch even if explicit default');
}

{
    const AbstractError = SBError.subtype('AbstractError');
    const ConcreteErrorA = AbstractError.subtype('ConcreteErrorA', 'msg');
    const ConcreteErrorB = AbstractError.subtype('ConcreteErrorB', 'msg');
    
    let ranIt;
    SBError.switch(new ConcreteErrorA(), {
        ConcreteErrorB: () => {
            assert.fail('switch shouldn\'t run spurious branches');
        },
        AbstractError: () => {
            ranIt = true;
        },
        Error: () => {
            assert.fail('switch shouldn\'t run parent branches when child ' +
                    'is available');
        },
        Object: () => {
            assert.fail('switch shouldn\'t run parent branches when child ' +
                    'is available');        
        }
    });
    
    assert(ranIt, 'should run parent branch if leaf unavailable');
}

{
    const AbstractError = SBError.subtype('AbstractError');
    const ConcreteErrorA = AbstractError.subtype('ConcreteErrorA', 'msg');
    const ConcreteErrorB = AbstractError.subtype('ConcreteErrorB', 'msg');
    
    let ranIt;
    SBError.switch(new ConcreteErrorA(), {
        ConcreteErrorB: () => {
            assert.fail('switch shouldn\'t run spurious branches');
        },
        Error: () => {
            ranIt = true;
        },
        Object: () => {
            assert.fail('switch shouldn\'t run parent branches when child ' +
                    'is available');        
        }
    });
    
    assert(ranIt, 'should run Error branch if parents unavailable');
}

{
    const AbstractError = SBError.subtype('AbstractError');
    const ConcreteErrorA = AbstractError.subtype('ConcreteErrorA', 'msg');
    const ConcreteErrorB = AbstractError.subtype('ConcreteErrorB', 'msg');
    
    let ranIt;
    SBError.switch(new ConcreteErrorA(), {
        ConcreteErrorB: () => {
            assert.fail('switch shouldn\'t run spurious branches');
        },
        Object: () => {
            ranIt = true;       
        }
    });
    
    assert(ranIt, 'should run Object branch if parents unavailable');
}

{
    const AbstractError = SBError.subtype('AbstractError');
    const ConcreteErrorA = AbstractError.subtype('ConcreteErrorA', 'msg');
    const ConcreteErrorB = AbstractError.subtype('ConcreteErrorB', 'msg');
    
    let ranIt;
    SBError.switch(new ConcreteErrorA(), {
        ConcreteErrorB: () => {
            assert.fail('switch shouldn\'t run spurious branches');
        }
    }, () => {
        ranIt = true;
    });
    
    assert(ranIt, 'should run default branch if nothing else');
}

{
    const AbstractError = SBError.subtype('AbstractError');
    const ConcreteErrorA = AbstractError.subtype('ConcreteErrorA', 'msg');
    const ConcreteErrorB = AbstractError.subtype('ConcreteErrorB', 'msg');
    
    try {
        SBError.switch(new ConcreteErrorA(), {
            ConcreteErrorB: () => {
                assert.fail('switch shouldn\'t run spurious branches');
            }
        });
        
        assert.fail('default default should throw an error');
    }
    catch (e) {
        assert(e instanceof SBError.DefaultSwitchCase,
                'default default didn\'t throw DefaultSwitchCase error');        
    }
}

{
    try {
        SBError.switch(null);
    }
    catch (e) {
        assert(e instanceof SBError.ThrownValueWasNullOrUndefined,
                'switching on null value should throw ' +
                'ThrownValueWasNullOrUndefined error');
        assert(e.message.includes('null'), 'switching on null value should ' +
                'throw error whose message includes "null": ' + e.message);
    }
}

{
    try {
        SBError.switch();
    }
    catch (e) {
        assert(e instanceof SBError.ThrownValueWasNullOrUndefined,
                'switching on undefined value should throw ' +
                'ThrownValueWasNullOrUndefined error');
        assert(e.message.includes('undefined'), 'switching on null value ' +
                'should throw error whose message includes "undefined": ' +
                e.message);
    }
}

{
    const switchResult = SBError.switch('test', {
        String: () => 5
    });
    
    assert.equal(switchResult, 5, 'Switch returns branch result.');
}

{
    const switchResult = SBError.switch('test', {}, () => 6);
    
    assert.equal(switchResult, 6, 'Switch returns default result.');
}

{
	let receivedTemplate;
	let receivedDetails;

	const SubError = SBError.subtype('SubError', {
		template: '{{foo}}',
		templater: (template, details) => {
			receivedTemplate = template;
			receivedDetails = details;
			
			return 'bar';
		}
	});
	
	const subErrorInstance = new SubError({foo: 5});
	
	assert.equal(subErrorInstance.message, 'bar',
			'Message reflects custom renderer');
	assert.equal(receivedTemplate, '{{foo}}',
			'Custom renderer received template.');
	assert.deepEqual(receivedDetails, {foo: 5},
			'Custom renderer received details.');
}

{
	const AError = SBError.subtype(
			'AError', { template: '{{foo}}', templater: () => 'bar' });
	const BError = AError.subtype('BError', '{{bazz}}');
	
	const b = new BError({ foo: 'x', bazz: 'y' });
	
	assert.equal(b.message, 'bar', 'Subtype inherits templater.');
}

{
	const AbstractError =
			SBError.subtype('AbstractError', { templater: () => 'foo' });

	try {
		new AbstractError();
	}
    catch (e) {
        assert(e instanceof SBError.CannotInstantiateAbstract,
        		'custom templater still does\'t allow instantiation of ' +
        		'abstract error');
    }
}

console.log('All tests passed.');
