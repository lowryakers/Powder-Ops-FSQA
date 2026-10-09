#!/usr/bin/env node
// readydoc-mcp — a stdio MCP server the bots launch locally. It only calls
// ReadyDoc's REST surface over HTTPS with a bot token; nothing here runs inside
// ReadyDoc, so the Railway service is unchanged.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { readConfig, makeClient, buildTools, ConfigError } from './src/client.mjs';

let config;
try { config = readConfig(); }
catch (err) {
  process.stderr.write(`${err instanceof ConfigError ? err.message : err.stack}\n`);
  process.exit(1);
}

const tools = buildTools(makeClient(config));
const byName = new Map(tools.map(t => [t.name, t]));

const server = new Server({ name: 'readydoc', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
}));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const tool = byName.get(req.params.name);
  if (!tool) return { isError: true, content: [{ type: 'text', text: `No tool called ${req.params.name}.` }] };
  return tool.handler(req.params.arguments || {});
});

await server.connect(new StdioServerTransport());
