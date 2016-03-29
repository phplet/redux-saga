/* eslint-disable no-unused-vars, no-constant-condition */

import test from 'tape'
import { createStore, applyMiddleware } from 'redux'
import sagaMiddleware from '../../src'
import { take, put, fork, join, call, race, cancel } from '../../src/effects'


test('synchronous sequential takes', assert => {
  assert.plan(1);

  const actual = []
  const store = applyMiddleware(sagaMiddleware(root))(createStore)(() => {})

  function* fnA() {
    actual.push( yield take('a1') )
    actual.push( yield take('a3') )
  }

  function* fnB() {
    actual.push( yield take('a2') )
  }

  function* root() {
    yield fork(fnA)
    yield fork(fnB)
  }

  store.dispatch({type: 'a1'})
  store.dispatch({type: 'a2'})
  store.dispatch({type: 'a3'})

  assert.deepEqual(actual, [{type: 'a1'}, {type: 'a2'}, {type: 'a3'}],
    "Sagas must take consecutive actions dispatched synchronously"
  );
  assert.end();

});

test('synchronous concurrent takes', assert => {
  assert.plan(1);

  const actual = []
  const store = applyMiddleware(sagaMiddleware(root))(createStore)(() => {})
  /**
    If a1 wins, then a2 cancellation means it will not take the next 'a2' action,
    dispatched immediately by the store after 'a1'; so the 2n take('a2') should take it
  **/
  function* root() {
    actual.push(yield race({
      a1: take('a1'),
      a2: take('a2')
    }))

    actual.push( yield take('a2') )
  }

  store.dispatch({type: 'a1'})
  store.dispatch({type: 'a2'})

  assert.deepEqual(actual, [{ a1: {type: 'a1'} }, {type: 'a2'}],
    "In concurrent takes only the winner must take an action"
  );
  assert.end();

});

test('synchronous parallel takes', assert => {
  const actual = []
  const store = applyMiddleware(sagaMiddleware(root))(createStore)(() => {})

  function* root() {
    actual.push(yield [
      take('a1'),
      take('a2')
    ])
  }

  store.dispatch({type: 'a1'})
  assert.deepEqual(actual, [],
    "Saga must wait for all parallel actions"
  );

  store.dispatch({type: 'a2'})
  assert.deepEqual(actual, [[{type: 'a1'}, {type: 'a2'}]],
    "Saga must resolve once all parallel actions dispatched"
  );
  assert.end()

});

test('synchronous parallel + concurrent takes', assert => {

  const actual = []
  const store = applyMiddleware(sagaMiddleware(root))(createStore)(() => {})

  function* root() {
    actual.push(
      yield [
        race({
          a1: take('a1'),
          a2: take('a2')
        }),
        take('a2')
      ]
    )
  }


  store.dispatch({type: 'a1'})
  assert.deepEqual(actual, [],
    "Saga must wait for all parallel actions"
  );

  store.dispatch({type: 'a2'})
  assert.deepEqual(actual, [[{a1: {type: 'a1'}}, {type: 'a2'}]],
    "Saga must resolve once all parallel actions dispatched"
  );
  assert.end()

});

// see https://github.com/reactjs/redux/issues/1240
test('startup actions (fired before store creation/middleware setup is complete)', assert => {
  assert.plan(1);

  const actual = []

  const store = applyMiddleware(
    sagaMiddleware(saga)
  )(createStore)((state, action) => {
    if(action.type === 'a')
      actual.push(action.payload)
    return true
  })

  /*
    Saga starts dispatching actions immediately after being started
    But since sagas are started immediately by the saga middleware
    It means saga will dispatch actions while the store creation
    is still running (applyMiddleware has not yet returned)
  */
  function* saga() {
    yield put({type: 'a', payload: 1})
    yield put({type: 'a', payload: 2})
    yield put({type: 'a', payload: 3})
  }

  setTimeout(() => {
    assert.deepEqual(actual, [1,2,3],
      "Sagas must take actions from each other"
    );
    assert.end();
  }, 0)

});

test('synchronous takes + puts', assert => {
  assert.plan(1);

  const actual = []

  const store = applyMiddleware(sagaMiddleware(saga))(createStore)((state, action) => {
    if(action.type === 'a')
      actual.push(action.payload)
    return true
  })

  function* saga() {
    yield take('a')
    yield put({type: 'a', payload: 'ack-1'})
    yield take('a')
    yield put({type: 'a', payload: 'ack-2'})
  }

  store.dispatch({type: 'a', payload: 1})
  store.dispatch({type: 'a', payload: 2})

  setTimeout(() => {
    assert.deepEqual(actual, [1, 'ack-1', 2, 'ack-2'],
      "Sagas must be able to interleave takes and puts without losing actions"
    );
    assert.end();
  }, 0)

});


// see https://github.com/yelouafi/redux-saga/issues/50
test('inter-saga put/take handling', assert => {
  assert.plan(1);

  function* fnA() {
    while(true) {
      let {payload} = yield take('a')
      yield fork(someAction, payload)
    }
  }

  function* fnB() {
    yield put({type: 'a', payload: 1})
    yield put({type: 'a', payload: 2})
    yield put({type: 'a', payload: 3})
  }

  function* someAction(payload) {
    actual.push(payload)
  }

  function* root() {
    yield [
      fork(fnA),
      fork(fnB)
    ]
  }

  const store = applyMiddleware(sagaMiddleware(root))(createStore)(() => {})
  const actual = []

  setTimeout(() => {
    assert.deepEqual(actual, [1,2,3],
      "Sagas must take actins from each other"
    );
    assert.end();
  }, 0)

});

test('inter-saga send/aknowledge handling', assert => {
  assert.plan(1);

  const actual = []
  const push = ({type}) => actual.push(type)
  const store = applyMiddleware(sagaMiddleware(root))(createStore)(() => {})


  function* fnA() {
    push( yield take('msg-1') )
    yield put({type: 'ack-1'})
    push( yield take('msg-2') )
    yield put({type: 'ack-2'})
  }

  function* fnB() {
    yield put({type: 'msg-1'})
    push( yield take('ack-1') )
    yield put({type: 'msg-2'})
    push( yield take('ack-2') )
  }

  function* root() {
    yield [
      fork(fnA),
      fork(fnB)
    ]
  }



  setTimeout(() => {
    assert.deepEqual(actual, ['msg-1', 'ack-1', 'msg-2', 'ack-2'],
      "Sagas must take actions from each other in the right order"
    );
    assert.end();
  }, 0)

});
