import invariant from 'invariant';
import { Map, fromJS } from 'immutable';

import {
	PortRecord,
	PortData,
	PortGraphicalAttributes,
	PositionRecord,
} from '../constants/flowdesigner.model';
import { removeLink } from '../actions/link.actions';
import linkReducer from './link.reducer';
import { portOutLink, portInLink } from '../selectors/linkSelectors';

import {
	FLOWDESIGNER_PORT_ADD,
	FLOWDESIGNER_PORT_UPDATE,
	FLOWDESIGNER_PORT_REMOVE,
	FLOWDESIGNER_PORT_ADDS,
	FLOWDESIGNER_PORT_SET_GRAPHICAL_ATTRIBUTES,
	FLOWDESIGNER_PORT_REMOVE_GRAPHICAL_ATTRIBUTES,
	FLOWDESIGNER_PORT_SET_DATA,
	FLOWDESIGNER_PORT_REMOVE_DATA,
	PORT_SINK,
	PORT_SOURCE,
} from '../constants/flowdesigner.constants';
import { Flow, Port } from '../api';

/**
 * get ports attached to a node
 */
function filterPortsByNode(ports, nodeId) {
	return ports.filter(port => port.nodeId === nodeId);
}

/**
 * get ports of direction EMITTER or SINK
 */
function filterPortsByDirection(ports, direction) {
	return ports.filter(port => port.getPortDirection() === direction);
}

/**
 * for a new port calculate its index by retrieving all its siblings
 */
function calculateNewPortIndex(ports, port) {
	return filterPortsByDirection(
		filterPortsByNode(ports, port.nodeId),
		port.graphicalAttributes.properties.type,
	).size;
}

function indexPortMap(ports) {
	let i = 0;
	return ports
		.sort((a, b) => {
			if (a.getIndex() < b.getIndex()) {
				return -1;
			}
			if (a.getIndex() > b.getIndex()) {
				return 1;
			}
			return 0;
		})
		.map(port => {
			i += 1;
			return port.setIndex(i - 1);
		});
}

/**
 * @deprecated
 * @param {*} state
 * @param {*} port
 */
function setPort(state, port) {
	// determine index
	// create port
	// add port to state
	// add out/in info
	const index: number =
		port.graphicalAttributes.properties.index ||
		calculateNewPortIndex(state.get('ports'), port);
	const newState = state.setIn(
		['ports', port.id],
		new PortRecord({
			id: port.id,
			nodeId: port.nodeId,
			data: new PortData(port.data).set(
				'properties',
				fromJS(port.data && port.data.properties) || new Map(),
			),
			graphicalAttributes: new PortGraphicalAttributes(port.graphicalAttributes)
				.set('position', new PositionRecord(port.graphicalAttributes.position))
				.set(
					'properties',
					fromJS(
						port.graphicalAttributes && {
							index,
							...port.graphicalAttributes.properties,
						},
					) || new Map(),
				),
		}),
	);
	const type = port.graphicalAttributes.properties.type;
	if (type === PORT_SOURCE) {
		return newState.setIn(['out', port.nodeId, port.id], new Map());
	} else if (type === PORT_SINK) {
		return newState.setIn(['in', port.nodeId, port.id], new Map());
	}
	invariant(
		true,
		`Can't set a new port ${port.id} if it
		data.graphicalAttributes.properties.type !== EMITTER || SINK,
		given ${port.graphicalAttributes.properties.type}`,
	);
	return state;
}

function addPortDeprecated(action, state) {
	if (!state.getIn(['nodes', action.nodeId])) {
		invariant(false, `Can't set a new port ${action.id} on non existing node ${action.nodeId}`);
	}
	return setPort(state, {
		id: action.id,
		nodeId: action.nodeId,
		data: action.data,
		graphicalAttributes: action.graphicalAttributes,
	});
}

function addPort(state, action) {
	if (Flow.hasPort(state, action.portId)) {
	}
	if (action.port && Port.isPort(action.port)) {
		return Flow.addPort(state, action.port);
	}
	// @deprecated bellow
	return addPortDeprecated(action, state);
}

export default function portReducer(state, action) {
	switch (action.type) {
		case FLOWDESIGNER_PORT_ADD:
			return addPort(state, action);
		case FLOWDESIGNER_PORT_UPDATE:
			return state;
		case FLOWDESIGNER_PORT_REMOVE: {
			if (!state.getIn(['ports', action.portId])) {
				invariant(false, `Can not remove port ${action.portId} since it doesn't exist`);
			}
			const port = state.getIn(['ports', action.portId]);
			if (port) {
				const newState = portInLink(state, action.portId)
					.reduce(
						(cumulativeState, link) =>
							linkReducer(cumulativeState, removeLink(link.id)),
						portOutLink(state, action.portId).reduce(
							(cumulativeState, link) =>
								linkReducer(cumulativeState, removeLink(link.id)),
							state,
						),
					)
					.deleteIn(['ports', action.portId])
					.deleteIn([
						'out',
						state.getIn(['ports', action.portId, 'nodeId']),
						action.portId,
					])
					.deleteIn([
						'in',
						state.getIn(['ports', action.portId, 'nodeId']),
						action.portId,
					]);
				return newState.mergeDeep({
					ports: indexPortMap(
						filterPortsByDirection(
							filterPortsByNode(newState.get('ports'), port.nodeId),
							port.getPortDirection(),
						),
					),
				});
			}
			return state;
		}
		case FLOWDESIGNER_PORT_ADDS: {
			const localAction = action;
			if (!state.getIn(['nodes', action.nodeId])) {
				invariant(false, `Can't set a new ports on non existing node ${action.nodeId}`);
			}
			return action.ports.reduce(
				(cumulatedState, port) =>
					setPort(cumulatedState, {
						id: port.id,
						nodeId: localAction.nodeId,
						data: port.data,
						graphicalAttributes: port.graphicalAttributes,
					}),
				state,
			);
		}
		case FLOWDESIGNER_PORT_SET_GRAPHICAL_ATTRIBUTES:
			if (!state.getIn(['ports', action.portId])) {
				invariant(
					false,
					`Can't set an graphical attribute on non existing port ${action.portId}`,
				);
			}
			try {
				return state.mergeIn(
					['ports', action.portId, 'graphicalAttributes'],
					fromJS(action.graphicalAttributes),
				);
			} catch (error) {
				return state.mergeIn(
					['ports', action.portId, 'graphicalAttributes', 'properties'],
					fromJS(action.graphicalAttributes),
				);
			}
		case FLOWDESIGNER_PORT_REMOVE_GRAPHICAL_ATTRIBUTES:
			if (!state.getIn(['ports', action.portId])) {
				invariant(
					false,
					`Can't remove a graphical attribute on non existing port ${action.portId}`,
				);
			}
			return state.deleteIn([
				'ports',
				action.portId,
				'graphicalAttributes',
				'properties',
				action.graphicalAttributesKey,
			]);
		case FLOWDESIGNER_PORT_SET_DATA:
			if (!state.getIn(['ports', action.portId])) {
				invariant(false, `Can't set a data on non existing port ${action.portId}`);
			}
			try {
				return state.mergeIn(['ports', action.portId, 'data'], fromJS(action.data));
			} catch (error) {
				return state.mergeIn(
					['ports', action.portId, 'data', 'properties'],
					fromJS(action.data),
				);
			}
		case FLOWDESIGNER_PORT_REMOVE_DATA:
			if (!state.getIn(['ports', action.portId])) {
				invariant(false, `Can't remove a data on non existing port ${action.portId}`);
			}
			return state.deleteIn(['ports', action.portId, 'data', 'properties', action.dataKey]);
		default:
			return state;
	}
}
