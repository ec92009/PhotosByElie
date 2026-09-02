((globalScope, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (globalScope) globalScope.photosByElieGalleryCommands = api;
})(typeof globalThis === "undefined" ? null : globalThis, () => {
  const COMMAND_BATCH_SIZE = 500;
  const GROUP_ORDER = Object.freeze(["filters", "selection", "view", "actions-rating-color", "workflow"]);

  const selectionIds = (values = []) => [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  )];

  const selectVisibleIds = (selected = [], visible = []) => selectionIds([
    ...selectionIds(selected),
    ...selectionIds(visible),
  ]);

  const restoreVisibleSelection = (selected = [], visible = []) => {
    const visibleIds = new Set(selectionIds(visible));
    return selectionIds(selected).filter((photoId) => visibleIds.has(photoId));
  };

  const chunkSelection = (values = [], batchSize = COMMAND_BATCH_SIZE) => {
    const ids = selectionIds(values);
    const size = Math.max(1, Math.floor(Number(batchSize) || COMMAND_BATCH_SIZE));
    const batches = [];
    for (let start = 0; start < ids.length; start += size) batches.push(ids.slice(start, start + size));
    return batches;
  };

  const runSelectionBatches = async (values = [], dispatch, { batchSize = COMMAND_BATCH_SIZE } = {}) => {
    if (typeof dispatch !== "function") throw new Error("Selection batch dispatch requires a function.");
    const chunks = chunkSelection(values, batchSize);
    const batches = [];
    for (let batchIndex = 0; batchIndex < chunks.length; batchIndex += 1) {
      const photoIds = chunks[batchIndex];
      const metadata = { batchIndex, batchNumber: batchIndex + 1, totalBatches: chunks.length };
      try {
        batches.push({ ...metadata, photoIds, status: "fulfilled", value: await dispatch(photoIds, metadata) });
      } catch (error) {
        batches.push({
          ...metadata,
          photoIds,
          status: "rejected",
          reason: error?.message || "Selection batch failed.",
        });
      }
    }
    return batches;
  };

  const asList = (value) => Array.isArray(value) ? value : value ? [value] : [];
  const resolvedValue = (value, context) => typeof value === "function" ? value(context) : value;
  const groupRank = (group) => {
    const index = GROUP_ORDER.indexOf(group);
    return index < 0 ? GROUP_ORDER.length : index;
  };

  const commandIsAuthorized = (command, context) => {
    const roles = asList(command.roles || command.role);
    if (roles.length && !roles.includes(context.role)) return false;
    const surfaces = asList(command.surfaces || command.surface);
    if (surfaces.length && !surfaces.includes(context.surface)) return false;
    const workflows = asList(command.workflows || command.workflow);
    if (workflows.length && !workflows.includes(context.workflow)) return false;
    return resolvedValue(command.authorized, context) !== false;
  };

  const resolveCommand = (command, context) => {
    const dynamicState = resolvedValue(command.state, context) || {};
    const enabled = dynamicState.enabled ?? resolvedValue(command.enabled, context) ?? true;
    const disabledReason = enabled
      ? ""
      : String(dynamicState.disabledReason || resolvedValue(command.disabledReason, context) || "Unavailable in the current context.");
    return {
      ...command,
      ...dynamicState,
      label: String(dynamicState.label || resolvedValue(command.label, context) || command.id),
      icon: String(dynamicState.icon || resolvedValue(command.icon, context) || ""),
      shortcutLabel: String(dynamicState.shortcutLabel || resolvedValue(command.shortcutLabel, context) || ""),
      tooltip: String(dynamicState.tooltip || resolvedValue(command.tooltip, context) || disabledReason),
      enabled: Boolean(enabled),
      disabledReason,
      hidden: Boolean(dynamicState.hidden ?? resolvedValue(command.hidden, context) ?? false),
    };
  };

  const normalizedKey = (value, caseSensitive) => {
    const key = String(value || "");
    return caseSensitive ? key : key.toLowerCase();
  };

  const matchesKeyboardShortcut = (event, shortcut) => {
    if (!event || !shortcut) return false;
    const candidate = typeof shortcut === "string" ? { key: shortcut } : shortcut;
    const primary = Boolean(event.metaKey || event.ctrlKey);
    if (candidate.primary === true && !primary) return false;
    if (candidate.primary !== true && primary) return false;
    if (Boolean(candidate.alt) !== Boolean(event.altKey)) return false;
    if (candidate.shift !== undefined && Boolean(candidate.shift) !== Boolean(event.shiftKey)) return false;
    const caseSensitive = candidate.caseSensitive === true;
    return normalizedKey(event.key, caseSensitive) === normalizedKey(candidate.key, caseSensitive);
  };

  const createRegistry = ({ commands = [], getContext = () => ({}), onDisabled = null } = {}) => {
    const seenIds = new Set();
    const commandList = commands.map((command, index) => {
      if (!command?.id || seenIds.has(command.id)) throw new Error(`Gallery command id must be unique: ${command?.id || "missing"}`);
      seenIds.add(command.id);
      return { ...command, _registryIndex: index };
    });

    const context = (overrides = {}) => ({ surface: "gallery", workflow: "gallery", role: "visitor", ...getContext(), ...overrides });
    const list = ({ includeHidden = false, context: contextOverrides = {} } = {}) => {
      const current = context(contextOverrides);
      return commandList
        .filter((command) => commandIsAuthorized(command, current))
        .map((command) => resolveCommand(command, current))
        .filter((command) => includeHidden || !command.hidden)
        .sort((left, right) => (
          groupRank(left.group) - groupRank(right.group)
          || Number(left.order || 0) - Number(right.order || 0)
          || left._registryIndex - right._registryIndex
        ));
    };

    const command = (id, options = {}) => list({
      includeHidden: options.includeHidden !== false,
      context: options.context || {},
    })
      .find((candidate) => candidate.id === id) || null;

    const dispatch = async (id, { source = "button", event = null, context: contextOverrides = {} } = {}) => {
      const current = context(contextOverrides);
      const definition = commandList.find((candidate) => candidate.id === id);
      if (!definition || !commandIsAuthorized(definition, current)) {
        return { status: "unauthorized", commandId: id, source };
      }
      const resolved = resolveCommand(definition, current);
      if (resolved.hidden) return { status: "hidden", commandId: id, source };
      if (!resolved.enabled) {
        onDisabled?.(resolved, current);
        return { status: "disabled", commandId: id, source, reason: resolved.disabledReason };
      }
      if (typeof definition.execute !== "function") {
        return { status: "unimplemented", commandId: id, source };
      }
      const value = await definition.execute(current, { source, event, command: resolved });
      return { status: "executed", commandId: id, source, value };
    };

    const commandForKeyboard = (event, { context: contextOverrides = {} } = {}) => list({ context: contextOverrides })
      .find((candidate) => matchesKeyboardShortcut(event, candidate.shortcut)) || null;

    const dispatchKeyboard = async (event, { context: contextOverrides = {} } = {}) => {
      const matched = commandForKeyboard(event, { context: contextOverrides });
      if (!matched) return { status: "unmatched" };
      return dispatch(matched.id, { source: "keyboard", event, context: contextOverrides });
    };

    return Object.freeze({ command, commandForKeyboard, dispatch, dispatchKeyboard, list });
  };

  return Object.freeze({
    COMMAND_BATCH_SIZE,
    GROUP_ORDER,
    chunkSelection,
    createRegistry,
    matchesKeyboardShortcut,
    restoreVisibleSelection,
    runSelectionBatches,
    selectVisibleIds,
  });
});
