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
  document_control: { en: 'Doc Control', es: 'Control de Docs' },

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
  target: { en: 'Target:', es: 'Objetivo:' },
  mixed_to: { en: 'Mixed to', es: 'Mezclado a' },
  verified: { en: 'Verified', es: 'Verificado' },
  optional: { en: 'optional', es: 'opcional' },
  out_of_range_fail: { en: 'outside the range — recorded as a FAIL', es: 'fuera del rango — registrado como FALLO' },
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
  // A recurring job missed several times is ONE job to do, with a history —
  // not several identical cards.
  missed_times: { en: 'missed', es: 'no hecho' },
  missed_since: { en: 'since', es: 'desde' },
  assigned_from: { en: 'assigned to you from', es: 'asignado a ti de' },
  // Food-contact tasks cannot be completed without ticking each step — QA has
  // to clear the machine before it runs again and cannot do that from a task
  // that does not say what was done.
  steps_required: {
    en: 'Food-contact equipment — tick each step you did. QA signs this off before the machine runs again.',
    es: 'Equipo de contacto con alimentos: marque cada paso que hizo. Calidad lo aprueba antes de volver a usar la máquina.',
  },
  steps_left: { en: 'step(s) still to tick', es: 'paso(s) por marcar' },
  cant_do_step: {
    en: "If a step could not be done, flag an issue instead of completing.",
    es: 'Si no pudo hacer un paso, reporte un problema en vez de completar.',
  },

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
  // ── Kiosks (public, no login) ───────────────────────────────────────────────
  // The four big-tap forms on the floor phones and tablets. They were English
  // only, which for half this shift means filling in a compliance form they
  // cannot read — the same reason the Operator View's strings are here.
  // The Spanish is plant vocabulary, not a literal gloss: a "sign out" is a
  // "registro de salida", and the scale form's warning is worded as an
  // instruction because that is what it is.
  k_lang: { en: 'Español', es: 'English' },

  // Shared across kiosks
  k_your_name: { en: 'Your Name *', es: 'Su Nombre *' },
  k_enter_name: { en: 'Enter your name', es: 'Escriba su nombre' },
  k_optional: { en: 'Optional', es: 'Opcional' },
  k_qty: { en: 'Qty', es: 'Cantidad' },
  k_condition: { en: 'Condition', es: 'Condición' },
  k_something_wrong: { en: 'Something went wrong', es: 'Algo salió mal' },
  k_submitting: { en: 'Submitting…', es: 'Enviando…' },

  // Component Sign In/Out
  k_comp_title: { en: 'Component Sign In/Out', es: 'Registro de Componentes' },
  k_comp_sub: { en: 'Log components pulled from or returned to inventory', es: 'Registre componentes retirados o devueltos al inventario' },
  k_direction: { en: 'Direction', es: 'Movimiento' },
  k_pulling: { en: 'Pulling from inventory', es: 'Retirando del inventario' },
  k_returning: { en: 'Returning to inventory', es: 'Devolviendo al inventario' },
  k_item_name: { en: 'Item Name *', es: 'Nombre del Artículo *' },
  k_part_number: { en: 'Part Number', es: 'Número de Parte' },
  k_lot_number: { en: 'Lot Number', es: 'Número de Lote' },
  k_mo_number: { en: 'MO #', es: 'MO #' },
  k_job_for: { en: "Job it's for", es: 'Para qué trabajo' },
  k_eg_wand: { en: 'e.g. Metal detector test wand', es: 'ej. Varilla de prueba del detector de metales' },
  k_eg_2: { en: 'e.g. 2', es: 'ej. 2' },
  k_sign_out: { en: 'Sign Out', es: 'Registrar Salida' },
  k_logged_as: { en: 'Logged as', es: 'Registrado como' },
  k_log_another: { en: 'Log Another', es: 'Registrar Otro' },

  // Knife / Blade
  k_knife_title: { en: 'Knife / Razor Blade / Scissor Sign In/Out', es: 'Registro de Cuchillos / Navajas / Tijeras' },
  k_knife_sub: { en: 'Tap your knife to check it out or return it', es: 'Toque su cuchillo para retirarlo o devolverlo' },
  k_search_knife: { en: 'Search by knife #...', es: 'Buscar por # de cuchillo...' },
  k_no_knives: { en: 'No knives registered yet.', es: 'Aún no hay cuchillos registrados.' },
  k_available: { en: 'Available', es: 'Disponible' },
  k_available_out: { en: 'Available to check out', es: 'Disponible para retirar' },
  k_issued_to: { en: 'Currently issued to', es: 'Actualmente con' },
  k_blade_condition: { en: 'Blade Condition', es: 'Condición de la Hoja' },
  k_check_out: { en: 'Check Out', es: 'Retirar' },
  k_check_in: { en: 'Check In', es: 'Devolver' },
  k_checked_out: { en: 'Checked Out', es: 'Retirado' },
  k_checked_in: { en: 'Checked In', es: 'Devuelto' },
  k_condition_recorded: { en: 'Condition recorded:', es: 'Condición registrada:' },
  k_back_to_list: { en: 'Back to list', es: 'Volver a la lista' },
  k_done: { en: 'Done', es: 'Listo' },
  k_need_name: { en: 'Please enter your name.', es: 'Por favor escriba su nombre.' },

  // Equipment / Tool / Chemical
  k_maint_title: { en: 'Equipment/Tool/Chemical Sign In-Out', es: 'Registro de Equipo / Herramienta / Químico' },
  k_maint_sub: { en: 'Sign out one or more items — tools, equipment, or chemicals', es: 'Registre la salida de uno o más artículos — herramientas, equipo o químicos' },
  k_items: { en: 'Items *', es: 'Artículos *' },
  k_select_item: { en: 'Select an item…', es: 'Seleccione un artículo…' },
  k_add_another: { en: 'Add another item…', es: 'Agregar otro artículo…' },
  k_use_spec: { en: 'Use specification (required for chemicals)…', es: 'Especificación de uso (obligatoria para químicos)…' },
  k_food_contact: { en: 'Food Contact', es: 'Contacto con Alimentos' },
  k_non_food_contact: { en: 'Non-Food Contact', es: 'Sin Contacto con Alimentos' },
  k_food_grade: { en: 'Food Grade', es: 'Grado Alimenticio' },
  k_non_food_grade: { en: 'Non-Food Grade', es: 'No Grado Alimenticio' },
  k_tool_box: { en: 'Tool Box #', es: '# de Caja de Herramientas' },
  k_asset_tag: { en: 'Asset Tag', es: 'Etiqueta de Activo' },
  k_pick_one_item: { en: 'Pick at least one item.', es: 'Seleccione al menos un artículo.' },
  // {q} / {name} are substituted by the caller.
  k_no_knives_match: { en: 'No knives match "{q}"', es: 'Ningún cuchillo coincide con "{q}"' },
  k_pick_use_spec: { en: 'Pick a use specification for {name}.', es: 'Seleccione una especificación de uso para {name}.' },
  k_item_signed_out: { en: 'Item Signed Out', es: 'Artículo Registrado' },
  k_return_by_qa: { en: 'Return is completed by QA in the app.', es: 'La devolución la completa QA en la aplicación.' },
  k_sign_out_more: { en: 'Sign Out More', es: 'Registrar Más' },

  // Scale verification
  k_scale_title: { en: 'Scale Verification', es: 'Verificación de Báscula' },
  k_which_scale: { en: 'Which scale are you checking?', es: '¿Qué báscula está verificando?' },
  k_different_scale: { en: 'Different scale', es: 'Otra báscula' },
  k_pick_different_form: { en: 'Pick a different form', es: 'Elegir otro formulario' },
  k_loading_forms: { en: 'Loading forms…', es: 'Cargando formularios…' },
  k_room_no: { en: 'Room #', es: '# de Sala' },
  k_eg_batching1: { en: 'e.g. Batching 1', es: 'ej. Batching 1' },
  k_weights_serial: { en: 'Weights serial #', es: '# de serie de las pesas' },
  k_readings: { en: 'Readings', es: 'Lecturas' },
  k_comments: { en: 'Comments', es: 'Comentarios' },
  k_first_last: { en: 'First and last name', es: 'Nombre y apellido' },
  k_submit_verification: { en: 'Submit Verification', es: 'Enviar Verificación' },
  k_verification_passed: { en: 'Verification Passed', es: 'Verificación Aprobada' },
  k_recorded_failed: { en: 'Recorded — FAILED', es: 'Registrado — FALLÓ' },
  // Worded as an instruction, because that is what it is.
  k_do_not_use: { en: 'Do not use this scale. Tell your supervisor and QA now.', es: 'No use esta báscula. Avise a su supervisor y a QA ahora.' },
  k_awaiting_qa: { en: 'Awaiting QA verification in Calibration.', es: 'Pendiente de verificación por QA en Calibración.' },
  k_check_another: { en: 'Check Another Scale', es: 'Verificar Otra Báscula' },
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
