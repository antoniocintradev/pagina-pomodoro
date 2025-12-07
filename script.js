// ----------------------
// Configurações iniciais
// ----------------------

const PRESETS = {
  pomodoro: {
    label: "Pomodoro",
    focus: 25,
    shortBreak: 5,
    longBreak: 15,
    longBreakInterval: 4,
  },
  "52-17": {
    label: "52/17",
    focus: 52,
    shortBreak: 17,
    longBreak: 0,
    longBreakInterval: 0,
  },
};

const STORAGE_KEY = "paginaPomodoroState_v1";

// Estado principal
const state = {
  currentPreset: "pomodoro",
  phase: "focus", // 'focus' | 'shortBreak' | 'longBreak'
  remainingSeconds: PRESETS.pomodoro.focus * 60,
  isRunning: false,
  cycleCount: 1,
  completedFocusSessions: 0,
  customConfig: {
    focus: 25,
    shortBreak: 5,
    longBreak: 15,
    longBreakInterval: 4,
  },
  autoStartNext: true,
  soundEnabled: true,
  notifyEnabled: false,
  tasks: [],
  selectedTaskId: null,
  statsByDay: {}, // { 'YYYY-MM-DD': {focusMinutes, focusSessions, shortBreaks, longBreaks} }
};

let timerId = null;

// ----------------------
// Utilitários
// ----------------------

function formatTime(seconds) {
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function todayKey() {
  const d = new Date();
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function getTodayStats() {
  const key = todayKey();
  if (!state.statsByDay[key]) {
    state.statsByDay[key] = {
      focusMinutes: 0,
      focusSessions: 0,
      shortBreaks: 0,
      longBreaks: 0,
    };
  }
  return state.statsByDay[key];
}

function saveState() {
  const toSave = {
    ...state,
    isRunning: false,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    Object.assign(state, data);
  } catch (e) {
    console.error("Erro ao carregar estado:", e);
  }
}

// Pequeno beep usando Web Audio API
function playBeep() {
  if (!state.soundEnabled) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;

  const ctx = new Ctx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = "sine";
  osc.frequency.value = 880; // Hz
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start();
  osc.stop(ctx.currentTime + 0.45);
}

function sendNotification(title, body) {
  if (!state.notifyEnabled || !("Notification" in window)) return;

  if (Notification.permission === "granted") {
    new Notification(title, { body });
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission().then((perm) => {
      if (perm === "granted") {
        new Notification(title, { body });
      }
    });
  }
}

// ----------------------
// DOM
// ----------------------

const timeDisplay = document.getElementById("timeDisplay");
const currentPhaseLabel = document.getElementById("currentPhaseLabel");
const cycleInfo = document.getElementById("cycleInfo");
const startPauseBtn = document.getElementById("startPauseBtn");
const resetBtn = document.getElementById("resetBtn");
const modeButtons = document.querySelectorAll(".chip[data-mode]");
const themeToggle = document.getElementById("themeToggle");

// Config inputs
const focusMinutesInput = document.getElementById("focusMinutes");
const shortBreakMinutesInput = document.getElementById("shortBreakMinutes");
const longBreakMinutesInput = document.getElementById("longBreakMinutes");
const longBreakIntervalInput = document.getElementById("longBreakInterval");
const autoStartNextInput = document.getElementById("autoStartNext");
const soundEnabledInput = document.getElementById("soundEnabled");
const notifyEnabledInput = document.getElementById("notifyEnabled");

// Tasks
const taskForm = document.getElementById("taskForm");
const taskTitleInput = document.getElementById("taskTitle");
const taskEstimateInput = document.getElementById("taskEstimate");
const taskListEl = document.getElementById("taskList");
const clearDoneTasksBtn = document.getElementById("clearDoneTasks");

// Stats
const statFocusTimeEl = document.getElementById("statFocusTime");
const statFocusSessionsEl = document.getElementById("statFocusSessions");
const statShortBreaksEl = document.getElementById("statShortBreaks");
const statLongBreaksEl = document.getElementById("statLongBreaks");
const resetStatsBtn = document.getElementById("resetStats");

// ----------------------
// Timer
// ----------------------

function getActiveConfig() {
  if (state.currentPreset === "custom") {
    return { ...state.customConfig };
  }
  return { ...PRESETS[state.currentPreset] };
}

function updatePhaseLabel() {
  const labels = {
    focus: "Foco",
    shortBreak: "Pausa curta",
    longBreak: "Pausa longa",
  };
  currentPhaseLabel.textContent = labels[state.phase] || "Foco";
}

function updateCycleInfo() {
  cycleInfo.textContent = `Ciclo ${state.cycleCount} • Pomodoros concluídos: ${state.completedFocusSessions}`;
}

function updateTimerDisplay() {
  timeDisplay.textContent = formatTime(state.remainingSeconds);
  updatePhaseLabel();
  updateCycleInfo();
}

function stopTimer() {
  if (timerId !== null) {
    clearInterval(timerId);
    timerId = null;
  }
  state.isRunning = false;
  startPauseBtn.textContent = "Iniciar";
  startPauseBtn.classList.add("primary");
}

function startTimer() {
  if (state.isRunning) return;

  state.isRunning = true;
  startPauseBtn.textContent = "Pausar";
  startPauseBtn.classList.remove("primary");

  timerId = setInterval(() => {
    state.remainingSeconds -= 1;
    if (state.remainingSeconds <= 0) {
      state.remainingSeconds = 0;
      updateTimerDisplay();
      stopTimer();
      onSessionComplete();
    } else {
      updateTimerDisplay();
    }
  }, 1000);
}

function resetTimerForCurrentPhase() {
  const cfg = getActiveConfig();
  if (state.phase === "focus") {
    state.remainingSeconds = cfg.focus * 60;
  } else if (state.phase === "shortBreak") {
    state.remainingSeconds = cfg.shortBreak * 60;
  } else {
    state.remainingSeconds = cfg.longBreak * 60;
  }
  updateTimerDisplay();
}

function switchToPhase(nextPhase, autoIncrementCycle = false) {
  const cfg = getActiveConfig();
  state.phase = nextPhase;
  if (nextPhase === "focus") {
    state.remainingSeconds = cfg.focus * 60;
    if (autoIncrementCycle) {
      state.cycleCount += 1;
    }
  } else if (nextPhase === "shortBreak") {
    state.remainingSeconds = cfg.shortBreak * 60;
  } else {
    state.remainingSeconds = cfg.longBreak * 60;
  }
  updateTimerDisplay();
}

function onSessionComplete() {
  const cfg = getActiveConfig();
  const stats = getTodayStats();

  if (state.phase === "focus") {
    stats.focusMinutes += cfg.focus;
    stats.focusSessions += 1;
    state.completedFocusSessions += 1;

    // Atualiza tarefa selecionada
    if (state.selectedTaskId) {
      const t = state.tasks.find((x) => x.id === state.selectedTaskId);
      if (t) {
        t.completedPomodoros = (t.completedPomodoros || 0) + 1;
        if (t.completedPomodoros >= t.estimate && !t.done) {
          t.done = true;
        }
      }
    }

    const interval = cfg.longBreakInterval || 0;
    if (cfg.longBreak > 0 && interval > 0 && state.completedFocusSessions % interval === 0) {
      sendNotification("Pausa longa 🎉", "Você conquistou uma pausa longa. Descanse bem.");
      playBeep();
      switchToPhase("longBreak", false);
    } else {
      sendNotification("Pausa curta ☕", "Faça uma pausa rápida para recarregar.");
      playBeep();
      switchToPhase("shortBreak", false);
    }
  } else if (state.phase === "shortBreak") {
    stats.shortBreaks += 1;
    sendNotification("Hora de focar 🔥", "Vamos voltar ao foco.");
    playBeep();
    switchToPhase("focus", true);
  } else if (state.phase === "longBreak") {
    stats.longBreaks += 1;
    sendNotification("Pausa longa concluída 🌿", "Pronto para outro ciclo de foco?");
    playBeep();
    switchToPhase("focus", true);
  }

  updateStatsUI();
  renderTasks();
  saveState();

  if (state.autoStartNext) {
    startTimer();
  }
}

// ----------------------
// Tarefas
// ----------------------

function addTask(title, estimate) {
  const hasCrypto =
    typeof window !== "undefined" &&
    window.crypto &&
    typeof window.crypto.randomUUID === "function";

  const task = {
    id: hasCrypto ? crypto.randomUUID() : String(Date.now()),
    title: title.trim(),
    estimate: Number(estimate) || 1,
    completedPomodoros: 0,
    done: false,
  };
  state.tasks.push(task);
  if (!state.selectedTaskId) {
    state.selectedTaskId = task.id;
  }
  renderTasks();
  saveState();
}

function toggleTaskDone(id, checked) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  t.done = !!checked;
  renderTasks();
  saveState();
}

function selectTask(id) {
  state.selectedTaskId = id;
  renderTasks();
  saveState();
}

function clearDoneTasks() {
  state.tasks = state.tasks.filter((t) => !t.done);
  if (state.selectedTaskId && !state.tasks.find((t) => t.id === state.selectedTaskId)) {
    state.selectedTaskId = state.tasks[0]?.id ?? null;
  }
  renderTasks();
  saveState();
}

function renderTasks() {
  taskListEl.innerHTML = "";
  if (state.tasks.length === 0) {
    const li = document.createElement("li");
    li.className = "task-item";
    li.style.opacity = "0.7";
    li.textContent = "Nenhuma tarefa ainda. Adicione a primeira acima.";
    taskListEl.appendChild(li);
    return;
  }

  state.tasks.forEach((task) => {
    const li = document.createElement("li");
    li.className = "task-item";
    if (state.selectedTaskId === task.id) {
      li.classList.add("selected");
    }

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = !!task.done;
    checkbox.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleTaskDone(task.id, checkbox.checked);
    });

    const main = document.createElement("div");
    main.className = "task-main";

    const titleEl = document.createElement("div");
    titleEl.className = "task-title";
    titleEl.textContent = task.title;

    const meta = document.createElement("div");
    meta.className = "task-meta";
    const est = task.estimate || 1;
    const done = task.completedPomodoros || 0;
    meta.textContent = `Estimado: ${est} • Concluídos: ${done}`;

    main.appendChild(titleEl);
    main.appendChild(meta);

    li.appendChild(checkbox);
    li.appendChild(main);

    li.addEventListener("click", () => {
      selectTask(task.id);
    });

    taskListEl.appendChild(li);
  });
}

// ----------------------
// Estatísticas
// ----------------------

function updateStatsUI() {
  const stats = getTodayStats();
  statFocusTimeEl.textContent = `${stats.focusMinutes} min`;
  statFocusSessionsEl.textContent = `${stats.focusSessions}`;
  statShortBreaksEl.textContent = `${stats.shortBreaks}`;
  statLongBreaksEl.textContent = `${stats.longBreaks}`;
}

// ----------------------
// Tema (claro/escuro)
// ----------------------

const THEME_KEY = "paginaPomodoroTheme";

function loadTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "light" || stored === "dark") {
    document.documentElement.dataset.theme = stored;
  } else {
    document.documentElement.dataset.theme = "dark";
  }
  updateThemeIcon();
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme || "dark";
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem(THEME_KEY, next);
  updateThemeIcon();
}

function updateThemeIcon() {
  const current = document.documentElement.dataset.theme || "dark";
  themeToggle.textContent = current === "dark" ? "🌙" : "☀️";
}

// ----------------------
// Eventos / Inicialização
// ----------------------

function applyStateToUI() {
  modeButtons.forEach((btn) => {
    const mode = btn.dataset.mode;
    btn.classList.toggle("chip-active", mode === state.currentPreset);
  });

  const cfg = getActiveConfig();
  focusMinutesInput.value = cfg.focus;
  shortBreakMinutesInput.value = cfg.shortBreak;
  longBreakMinutesInput.value = cfg.longBreak;
  longBreakIntervalInput.value = cfg.longBreakInterval || 0;

  autoStartNextInput.checked = !!state.autoStartNext;
  soundEnabledInput.checked = !!state.soundEnabled;
  notifyEnabledInput.checked = !!state.notifyEnabled;

  updateTimerDisplay();
  renderTasks();
  updateStatsUI();
}

function attachEventListeners() {
  startPauseBtn.addEventListener("click", () => {
    if (state.isRunning) {
      stopTimer();
    } else {
      startTimer();
    }
    saveState();
  });

  resetBtn.addEventListener("click", () => {
    stopTimer();
    state.cycleCount = 1;
    state.completedFocusSessions = 0;
    switchToPhase("focus", false);
    saveState();
  });

  modeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.mode;
      if (!mode || mode === state.currentPreset) return;

      state.currentPreset = mode;
      if (mode !== "custom") {
        const preset = PRESETS[mode];
        state.customConfig = { ...preset };
      }
      state.phase = "focus";
      state.cycleCount = 1;
      state.completedFocusSessions = 0;

      modeButtons.forEach((b) =>
        b.classList.toggle("chip-active", b === btn)
      );

      resetTimerForCurrentPhase();
      applyStateToUI();
      stopTimer();
      saveState();
    });
  });

  // Configurações
  [focusMinutesInput, shortBreakMinutesInput, longBreakMinutesInput, longBreakIntervalInput].forEach(
    (input) => {
      input.addEventListener("change", () => {
        const focus = Math.max(1, Number(focusMinutesInput.value) || 1);
        const shortBreak = Math.max(
          1,
          Number(shortBreakMinutesInput.value) || 1
        );
        const longBreak = Math.max(0, Number(longBreakMinutesInput.value) || 0);
        const longInterval = Math.max(
          0,
          Number(longBreakIntervalInput.value) || 0
        );
        state.customConfig = {
          focus,
          shortBreak,
          longBreak,
          longBreakInterval: longInterval,
        };
        state.currentPreset = "custom";
        modeButtons.forEach((btn) => {
          btn.classList.toggle(
            "chip-active",
            btn.dataset.mode === "custom"
          );
        });
        state.phase = "focus";
        state.cycleCount = 1;
        state.completedFocusSessions = 0;
        resetTimerForCurrentPhase();
        saveState();
      });
    }
  );

  autoStartNextInput.addEventListener("change", () => {
    state.autoStartNext = autoStartNextInput.checked;
    saveState();
  });

  soundEnabledInput.addEventListener("change", () => {
    state.soundEnabled = soundEnabledInput.checked;
    saveState();
  });

  notifyEnabledInput.addEventListener("change", () => {
    state.notifyEnabled = notifyEnabledInput.checked;
    if (state.notifyEnabled) {
      if ("Notification" in window) {
        Notification.requestPermission();
      }
    }
    saveState();
  });

  // Tarefas
  taskForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const title = taskTitleInput.value.trim();
    if (!title) return;
    const estimate = Number(taskEstimateInput.value) || 1;
    addTask(title, estimate);
    taskTitleInput.value = "";
  });

  clearDoneTasksBtn.addEventListener("click", () => {
    clearDoneTasks();
  });

  // Stats
  resetStatsBtn.addEventListener("click", () => {
    const key = todayKey();
    state.statsByDay[key] = {
      focusMinutes: 0,
      focusSessions: 0,
      shortBreaks: 0,
      longBreaks: 0,
    };
    updateStatsUI();
    saveState();
  });

  // Tema
  themeToggle.addEventListener("click", toggleTheme);
}

// Inicialização
(function init() {
  loadTheme();
  loadState();
  getTodayStats();
  state.isRunning = false;
  timerId = null;

  if (!PRESETS[state.currentPreset] && state.currentPreset !== "custom") {
    state.currentPreset = "pomodoro";
  }

  applyStateToUI();
  attachEventListeners();
})();
