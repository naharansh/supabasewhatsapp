-- Widen flow_nodes.node_type CHECK to allow the 'text_area' node.
--
-- Migration 010 created flow_nodes with an inline CHECK constraint that
-- Postgres auto-names `flow_nodes_node_type_check`. New node types must be
-- added here or flow-node inserts for those types are rejected at the DB
-- level (the API route passes node_type through as a plain string).

ALTER TABLE flow_nodes
  DROP CONSTRAINT IF EXISTS flow_nodes_node_type_check;

ALTER TABLE flow_nodes
  ADD CONSTRAINT flow_nodes_node_type_check
  CHECK (node_type IN (
    'start',
    'send_buttons',
    'send_list',
    'send_message',
    'collect_input',
    'condition',
    'set_tag',
    'handoff',
    'http_fetch',
    'text_area',
    'end'
  ));