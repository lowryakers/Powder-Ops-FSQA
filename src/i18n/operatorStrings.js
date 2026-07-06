const strings = {
  // Header
  my_tasks: { en: 'My Tasks', es: 'Mis Tareas' },
  due_today_count: { en: 'due today', es: 'para hoy' },
  total: { en: 'total', es: 'total' },
  overdue_count: { en: 'overdue', es: 'atrasadas' },
  loading_tasks: { en: 'Loading tasks...', es: 'Cargando tareas...' },

  // Department toggle
  all_teams: { en: 'All Teams', es: 'Todos' },
  maintenance: { en: 'Maintenance', es: 'Mantenimiento' },
  warehouse: { en: 'Warehouse', es: 'Almacén' },
  qa: { en: 'QA', es: 'QA' },
  cleaning: { en: 'Cleaning', es: 'Limpieza' },

  // Search & filters
  search_placeholder: { en: 'Search tasks, equipment, location...', es: 'Buscar tareas, equipos, ubicación...' },
  all_filter: { en: 'All', es: 'Todas' },
  daily: { en: 'Daily', es: 'Diaria' },
  weekly: { en: 'Weekly', es: 'Semanal' },
  monthly: { en: 'Monthly', es: 'Mensual' },
  quarterly: { en: 'Quarterly', es: 'Trimestral' },
  annual: { en: 'Annual', es: 'Anual' },

  // Stats
  overdue_label: { en: 'Overdue', es: 'Atrasadas' },
  today_label: { en: 'Today', es: 'Hoy' },
  this_week: { en: 'This Week', es: 'Esta Semana' },
  later: { en: 'Later', es: 'Después' },

  // Section headers
  section_overdue: { en: 'Overdue', es: 'Atrasadas' },
  section_due_today: { en: 'Due Today', es: 'Para Hoy' },
  section_this_week: { en: 'This Week', es: 'Esta Semana' },
  section_upcoming: { en: 'Upcoming', es: 'Próximas' },

  // Due date labels
  d_overdue: { en: 'd overdue', es: 'd atrasada' },
  due_today: { en: 'Due today', es: 'Vence hoy' },
  due_tomorrow: { en: 'Due tomorrow', es: 'Vence mañana' },
  due_in_days: { en: 'Due in', es: 'Vence en' },
  days: { en: 'days', es: 'días' },

  // Action buttons
  complete_task: { en: 'Complete task', es: 'Completar tarea' },
  report_issue: { en: 'Report an issue', es: 'Reportar un problema' },
  skip_na: { en: 'Skip — not applicable', es: 'Omitir — no aplica' },

  // Completion form
  mark_complete: { en: 'Mark Complete', es: 'Marcar Completa' },
  saving: { en: 'Saving...', es: 'Guardando...' },
  cancel: { en: 'Cancel', es: 'Cancelar' },
  notes: { en: 'Notes', es: 'Notas' },
  notes_optional: { en: '(optional)', es: '(opcional)' },
  assign_to: { en: 'Assign to', es: 'Asignar a' },
  leave_unassigned: { en: 'Leave unassigned', es: 'Sin asignar' },

  // Issue flagging
  report_an_issue: { en: 'Report an Issue', es: 'Reportar un Problema' },
  whats_the_issue: { en: "What's the issue? *", es: '¿Cuál es el problema? *' },
  issue_placeholder: { en: 'Describe the problem, what you observed, any safety concerns...', es: 'Describa el problema, lo que observó, preocupaciones de seguridad...' },
  flag_issue: { en: 'Flag Issue', es: 'Reportar Problema' },
  issue_reported: { en: 'Issue Reported', es: 'Problema Reportado' },
  flagged_by: { en: 'Flagged by', es: 'Reportado por' },
  issue_badge: { en: 'Issue', es: 'Problema' },

  // N/A skip
  na_title: { en: 'Not Applicable / Not In Use', es: 'No Aplica / Fuera de Uso' },
  na_description: { en: 'This task will be skipped and will not count as missed. The next occurrence will still be generated on schedule.', es: 'Esta tarea será omitida y no contará como perdida. La próxima ocurrencia se generará según lo programado.' },
  na_reason_label: { en: 'Reason (optional)', es: 'Razón (opcional)' },
  na_reason_not_in_use: { en: 'Equipment not in use', es: 'Equipo fuera de uso' },
  na_reason_production: { en: 'Production schedule change', es: 'Cambio de horario de producción' },
  na_reason_decommissioned: { en: 'Equipment decommissioned', es: 'Equipo decomisado' },
  na_reason_seasonal: { en: 'Seasonal shutdown', es: 'Cierre estacional' },
  na_reason_duplicate: { en: 'Duplicate task', es: 'Tarea duplicada' },
  skip_na_button: { en: 'Skip — Not Applicable', es: 'Omitir — No Aplica' },

  // Temp & Humidity
  record_readings: { en: 'Record Readings', es: 'Registrar Lecturas' },
  temperature: { en: 'Temperature (°F) *', es: 'Temperatura (°F) *' },
  humidity: { en: 'Humidity (%) *', es: 'Humedad (%) *' },
  humidity_warning: { en: 'Humidity exceeds 40% — notify manager and check dehumidifiers/A/C units.', es: 'La humedad supera el 40% — notifique al gerente y revise los deshumidificadores/A/C.' },
  rolling_doors: { en: 'Rolling doors verified closed', es: 'Puertas enrollables verificadas cerradas' },
  pass_range: { en: 'PASS — Within acceptable range', es: 'APROBADO — Dentro del rango aceptable' },
  fail_humidity: { en: 'FAIL — Humidity above 40% threshold', es: 'FALLO — Humedad por encima del umbral de 40%' },

  // Chemical dilution
  chemical_verification: { en: 'Chemical Verification', es: 'Verificación Química' },
  chemical_label: { en: 'Chemical *', es: 'Químico *' },
  select_chemical: { en: 'Select chemical', es: 'Seleccionar químico' },
  ppm_reading: { en: 'PPM Reading *', es: 'Lectura PPM *' },
  lot_number: { en: 'Lot Number', es: 'Número de Lote' },
  expiration_date: { en: 'Expiration Date', es: 'Fecha de Vencimiento' },
  acceptable_range: { en: 'Within acceptable range? *', es: '¿Dentro del rango aceptable? *' },
  pass: { en: 'Pass', es: 'Aprobado' },
  fail: { en: 'Fail', es: 'Fallo' },

  // Glass/Plastic inspection
  item_inspection: { en: 'Form 431-02 — Item Inspection', es: 'Formulario 431-02 — Inspección de Artículos' },
  edit_items: { en: 'Edit Items', es: 'Editar Artículos' },
  item: { en: 'Item', es: 'Artículo' },
  qty: { en: 'Qty', es: 'Cant.' },
  type: { en: 'Type', es: 'Tipo' },
  condition: { en: 'Condition', es: 'Condición' },
  items_inspected: { en: 'items inspected', es: 'artículos inspeccionados' },
  gbx_legend: { en: 'G = Good, B = Bad, X = Broken', es: 'G = Bueno, B = Malo, X = Roto' },
  damaged_warning: { en: 'Damaged/broken items detected — document details in notes below and notify your manager.', es: 'Artículos dañados/rotos detectados — documente los detalles en las notas y notifique a su gerente.' },
  brittle_inspection: { en: 'Brittle Plastic & Glass Inspection', es: 'Inspección de Plástico Frágil y Vidrio' },
  no_items_zone: { en: 'No brittle plastic or glass items in this zone.', es: 'No hay artículos de plástico frágil o vidrio en esta zona.' },
  add_item: { en: 'Add Item', es: 'Agregar Artículo' },
  save_changes: { en: 'Save Changes', es: 'Guardar Cambios' },

  // Forklift inspection
  daily_inspection: { en: 'Daily Inspection Checklist', es: 'Lista de Inspección Diaria' },
  inspection_item: { en: 'Inspection Item', es: 'Artículo de Inspección' },
  gbx_fork_legend: { en: 'G = Good, B = Bad/Poor, X = Broken/Unsafe', es: 'G = Bueno, B = Malo, X = Roto/Inseguro' },
  fork_warning: { en: 'Issue detected — document details in notes below. Do NOT operate equipment until cleared.', es: 'Problema detectado — documente los detalles en las notas. NO opere el equipo hasta que sea autorizado.' },
  hour_meter: { en: 'Hour Meter', es: 'Horómetro' },

  // Light inspection
  light_inspection: { en: 'Light Inspection', es: 'Inspección de Iluminación' },
  foot_candles: { en: 'Reading (foot-candles) *', es: 'Lectura (foot-candles) *' },
  fixtures_checked: { en: 'Fixtures Checked', es: 'Accesorios Revisados' },
  light_spec: { en: 'Production: min 30 fc | Inspection/QC: 50-130 fc', es: 'Producción: mín. 30 fc | Inspección/QC: 50-130 fc' },
  all_fixtures_pass: { en: 'All fixtures pass? *', es: '¿Todos los accesorios aprueban? *' },

  // Production clean
  production_verification: { en: 'Production Line Verification', es: 'Verificación de Línea de Producción' },
  allergen_check: { en: 'Allergen verification complete', es: 'Verificación de alérgenos completa' },
  atp_reading: { en: 'ATP Reading (RLU)', es: 'Lectura ATP (RLU)' },
  sanitizer_contact: { en: 'Sanitizer Contact (min)', es: 'Contacto de Sanitizante (min)' },
  visual_pass: { en: 'Visual inspection pass? *', es: '¿Inspección visual aprobada? *' },

  // Checklist
  checklist: { en: 'Checklist', es: 'Lista de Verificación' },
  steps_complete: { en: 'steps complete', es: 'pasos completados' },

  // Notes placeholders
  notes_temp: { en: 'Corrective actions taken, dehumidifier status...', es: 'Acciones correctivas tomadas, estado del deshumidificador...' },
  notes_glass: { en: 'Describe damaged items, locations...', es: 'Describa artículos dañados, ubicaciones...' },
  notes_chem: { en: 'Dilution adjustments made...', es: 'Ajustes de dilución realizados...' },
  notes_general: { en: 'Any issues or observations...', es: 'Cualquier problema u observación...' },

  // Empty state
  all_caught_up: { en: 'All caught up!', es: '¡Todo al día!' },
  no_tasks_pending: { en: 'tasks pending.', es: 'tareas pendientes.' },
  no_prefix: { en: 'No', es: 'Sin' },

  // Batch complete
  batch_complete: { en: 'Batch complete', es: 'Completar lote' },
  tasks_selected: { en: 'selected', es: 'seleccionadas' },
  task_word: { en: 'task', es: 'tarea' },
  tasks_word: { en: 'tasks', es: 'tareas' },
  clear: { en: 'Clear', es: 'Limpiar' },
  complete_all: { en: 'Complete All', es: 'Completar Todo' },
  completing_batch: { en: 'Completing...', es: 'Completando...' },

  // Toast messages
  toast_completed: { en: 'Task completed', es: 'Tarea completada' },
  toast_issue: { en: 'Issue reported', es: 'Problema reportado' },
  toast_na: { en: 'Marked not applicable', es: 'Marcada como no aplica' },
  toast_batch: { en: 'tasks completed', es: 'tareas completadas' },
  toast_batch_fail: { en: 'Batch complete failed', es: 'Error al completar lote' },
};

export function createTranslator(lang = 'en') {
  return (key, fallback) => {
    const entry = strings[key];
    if (!entry) return fallback || key;
    return entry[lang] || entry.en || fallback || key;
  };
}

export function formatDueLabelI18n(dueDate, t) {
  const today = new Date().toISOString().split('T')[0];
  const msPerDay = 86400000;
  const diff = Math.floor((new Date(dueDate) - new Date(today)) / msPerDay);
  if (diff < 0) return `${Math.abs(diff)}${t('d_overdue')}`;
  if (diff === 0) return t('due_today');
  if (diff === 1) return t('due_tomorrow');
  if (diff <= 7) return `${t('due_in_days')} ${diff} ${t('days')}`;
  return `${t('due_in_days')} ${dueDate}`;
}
