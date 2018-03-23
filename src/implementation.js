// @flow
import React, { Component, type Node } from 'react';
import PropTypes from 'prop-types';
import gud from 'gud';
import warning from 'fbjs/lib/warning';


const MAX_SIGNED_31_BIT_INT = 1073741823;

// Inlined Object.is polyfill.
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/is
function objectIs(x, y) {
  if (x === y) {
    return x !== 0 || 1 / x === 1 / (y: any);
  } else {
    return x !== x && y !== y;
  }
}

type RenderFn<T> = (value: T) => Node;

export type ProviderProps<T> = {
  value: T,
  children?: Node
};

export type ConsumerProps<T> = {
  children: RenderFn<T> | [RenderFn<T>],
  observedBits?: number
};

export type ConsumerState<T> = {
  value: T
};

export type Provider<T> = Component<ProviderProps<T>>;
export type Consumer<T> = Component<ConsumerProps<T>, ConsumerState<T>>;

export type Context<T> = {
  Provider: Class<Provider<T>>,
  Consumer: Class<Consumer<T>>
};

function createBroadcast (initialState) {
  let listeners = {}
  let id = 1
  let _state = initialState

  function getState () {
    return _state
  }

  function setState (state, changedBits) {
    _state = state
    const keys = Object.keys(listeners)
    let i = 0
    const len = keys.length
    for (; i < len; i++) {
      // if a listener gets unsubscribed during setState we just skip it
      if (listeners[keys[i]]) listeners[keys[i]](state, changedBits)
    }
  }

  // subscribe to changes and return the subscriptionId
  function subscribe (listener) {
    if (typeof listener !== 'function') {
      console.error('listener must be a function.')
      return
    }
    const currentId = id
    listeners[currentId] = listener
    id += 1
    return currentId
  }

  // remove subscription by removing the listener function
  function unsubscribe (id) {
    listeners[id] = undefined
  }

  return { getState, setState, subscribe, unsubscribe }
}

function onlyChild(children): any {
  return Array.isArray(children) ? children[0] : children;
}

function createReactContext<T>(
  defaultValue: T,
  calculateChangedBits: ?(a: T, b: T) => number
): Context<T> {
  const contextProp = '__create-react-context-' + gud() + '__';

  class Provider extends Component<ProviderProps<T>> {
    emitter = createBroadcast(this.props.value);

    static childContextTypes = {
      [contextProp]: PropTypes.object.isRequired
    };

    getChildContext() {
      return {
        [contextProp]: this.emitter
      };
    }

    componentWillReceiveProps(nextProps) {
      if (this.props.value !== nextProps.value) {
        let oldValue = this.props.value;
        let newValue = nextProps.value;
        let changedBits: number;

        if (objectIs(oldValue, newValue)) {
          changedBits = 0; // No change
        } else {
          changedBits =
            typeof calculateChangedBits === 'function'
              ? calculateChangedBits(oldValue, newValue)
              : MAX_SIGNED_31_BIT_INT;
          if (process.env.NODE_ENV !== 'production') {
            warning(
              (changedBits & MAX_SIGNED_31_BIT_INT) === changedBits,
              'calculateChangedBits: Expected the return value to be a ' +
                '31-bit integer. Instead received: %s',
              changedBits
            );
          }

          changedBits |= 0;

          if (changedBits !== 0) {
            this.emitter.setState(nextProps.value, changedBits);
          }
        }
      }
    }

    render() {
      return this.props.children;
    }
  }

  class Consumer extends Component<ConsumerProps<T>, ConsumerState<T>> {
    static contextTypes = {
      [contextProp]: PropTypes.object
    };

    observedBits: number;
    unsubscribeId: number;

    state: ConsumerState<T> = {
      value: this.getValue()
    };

    componentWillReceiveProps(nextProps) {
      let { observedBits } = nextProps;
      this.observedBits =
        observedBits === undefined || observedBits === null
          ? MAX_SIGNED_31_BIT_INT // Subscribe to all changes by default
          : observedBits;
    }

    componentDidMount() {
      if (this.context[contextProp]) {
        this.unsubscribeId = this.context[contextProp].subscribe(this.onUpdate);
      }
      let { observedBits } = this.props;
      this.observedBits =
        observedBits === undefined || observedBits === null
          ? MAX_SIGNED_31_BIT_INT // Subscribe to all changes by default
          : observedBits;
    }

    componentWillUnmount() {
      if (this.context[contextProp] && this.unsubscribeId) {
        this.context[contextProp].unsubscribe(this.unsubscribeId);
      }
    }

    getValue(): T {
      if (this.context[contextProp]) {
        return this.context[contextProp].getState();
      } else {
        return defaultValue;
      }
    }

    onUpdate = (newValue, changedBits: number) => {
      const observedBits: number = this.observedBits | 0;
      if ((observedBits & changedBits) !== 0) {
        this.setState({ value: this.getValue() });
      }
    };

    render() {
      return onlyChild(this.props.children)(this.state.value);
    }
  }

  return {
    Provider,
    Consumer
  };
}

export default createReactContext;
