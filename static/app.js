const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const historyEl = document.querySelector("#history");
const statusEl = document.querySelector("#status");
const dialog = document.querySelector("#workout-dialog");
const exerciseList = document.querySelector("#exercises");
const initData = tg?.initData || "";

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", "X-Telegram-Init-Data": initData, ...options.headers },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Не удалось выполнить запрос.");
  return body;
}

function showError(error) {
  statusEl.textContent = error.message;
  statusEl.classList.add("visible");
}

async function loadHistory() {
  try {
    const workouts = await api("/api/workouts");
    document.querySelector("#count").textContent = workouts.length;
    if (!workouts.length) {
      historyEl.innerHTML = '<div class="empty"><span>✳</span><strong>Пока нет тренировок</strong><p>Добавь первую — история начнётся здесь.</p></div>';
      return;
    }
    historyEl.innerHTML = workouts.map((workout) => {
      const dateText = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${workout.date}T12:00:00`));
      const details = workout.exercises.map((exercise) => `<div class="history-exercise"><span>${escapeHtml(exercise.name)}</span><span>${exercise.sets.map((s) => `${s.reps} × ${s.weight} кг`).join(" · ")}</span></div>`).join("");
      return `<article class="workout-card"><div class="workout-date">${dateText}</div>${details}</article>`;
    }).join("");
  } catch (error) { showError(error); }
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function addSet(container, reps = "", weight = "") {
  const row = document.createElement("div");
  row.className = "set-row";
  row.innerHTML = `<span class="set-number"></span><input class="reps" type="number" min="1" max="1000" placeholder="8" aria-label="Повторы" required value="${reps}"><input class="weight" type="number" min="0" max="10000" step="0.5" placeholder="40" aria-label="Вес в килограммах" required value="${weight}"><button type="button" class="remove-set" aria-label="Удалить подход">×</button>`;
  row.querySelector(".remove-set").addEventListener("click", () => { row.remove(); renumberSets(container); });
  container.append(row);
  renumberSets(container);
}

function renumberSets(container) {
  [...container.children].forEach((row, index) => row.querySelector(".set-number").textContent = index + 1);
}

function addExercise(name = "") {
  const element = document.querySelector("#exercise-template").content.cloneNode(true);
  const card = element.querySelector(".exercise-card");
  const sets = card.querySelector(".sets");
  card.querySelector(".exercise-name").value = name;
  card.querySelector(".add-set").addEventListener("click", () => addSet(sets));
  card.querySelector(".remove-exercise").addEventListener("click", () => card.remove());
  addSet(sets);
  exerciseList.append(card);
}

document.querySelector("#open-form").addEventListener("click", () => {
  document.querySelector("#workout-date").value = new Date().toLocaleDateString("en-CA");
  exerciseList.replaceChildren();
  addExercise();
  statusEl.classList.remove("visible");
  dialog.showModal();
});
document.querySelector("#close-form").addEventListener("click", () => dialog.close());
document.querySelector("#add-exercise").addEventListener("click", () => addExercise());

document.querySelector("#workout-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = event.currentTarget.querySelector('[type="submit"]');
  const exercises = [...exerciseList.querySelectorAll(".exercise-card")].map((card) => ({
    name: card.querySelector(".exercise-name").value.trim(),
    sets: [...card.querySelectorAll(".set-row")].map((row) => ({ reps: row.querySelector(".reps").value, weight: row.querySelector(".weight").value })),
  }));
  submit.disabled = true;
  try {
    await api("/api/workouts", { method: "POST", body: JSON.stringify({ date: document.querySelector("#workout-date").value, exercises }) });
    dialog.close();
    await loadHistory();
  } catch (error) { showError(error); }
  finally { submit.disabled = false; }
});

loadHistory();
