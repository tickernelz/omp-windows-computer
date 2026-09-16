export const UIA_TO_NORMALIZED_ROLES: Record<string, string> = {
  button: "button",
  checkbox: "checkbox",
  combobox: "combobox",
  edit: "textbox",
  document: "document",
  text: "statictext",
  image: "image",
  hyperlink: "link",
  list: "list",
  listitem: "listitem",
  menu: "menu",
  menuitem: "menuitem",
  menubar: "menubar",
  tab: "tabgroup",
  tabitem: "tab",
  table: "table",
  tree: "tree",
  treeitem: "treeitem",
  toolbar: "toolbar",
  window: "window",
  pane: "panel",
  group: "panel",
  custom: "custom",
  scrollbar: "scrollbar",
  slider: "slider",
  spinner: "spinbutton",
  progressbar: "progressbar",
  radiobutton: "radiobutton",
  separator: "separator",
  statusbar: "statusbar",
  splitbutton: "button",
  thumb: "thumb",
  datagrid: "table",
  dataitem: "listitem",
  header: "header",
  headeritem: "columnheader",
  calendar: "calendar",
  tooltip: "tooltip",
  titlebar: "titlebar"
};

export function normalizeUiaRole(rawRole: string): string {
  if (!rawRole) return "unknown";
  const cleaned = rawRole.toLowerCase().replace("controltype.", "").trim();
  return UIA_TO_NORMALIZED_ROLES[cleaned] || cleaned;
}
