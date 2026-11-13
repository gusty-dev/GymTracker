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

const exerciseMuscles = [
  { match: /жим лёжа|жим лежа|bench press|отжиман|push.?up/, title: "Жим лёжа", hint: "Грудь, трицепс и передняя часть плеч", muscles: ["chest", "triceps", "shoulders"] },
  { match: /жим стоя|армейский жим|жим над головой|overhead press|shoulder press/, title: "Жим над головой", hint: "Плечи и трицепс", muscles: ["shoulders", "triceps"] },
  { match: /присед|squat/, title: "Приседания", hint: "Квадрицепсы и ягодицы", muscles: ["quads", "glutes"] },
  { match: /становая|румынская тяга|тяга на прямых|deadlift|romanian deadlift/, title: "Становая тяга", hint: "Задняя поверхность бедра, спина и ягодицы", muscles: ["hamstrings", "glutes", "upperback", "lats"] },
  { match: /тяга штанги|тяга гантел|тяга блока|тяга горизонт|гребн|row|pulldown|подтягиван/, title: "Тяга на спину", hint: "Широчайшие, верх спины и бицепс", muscles: ["lats", "upperback", "biceps"] },
  { match: /сгибан.*бицепс|подъём на бицепс|подъем на бицепс|bicep curl|бицепс/, title: "Сгибание на бицепс", hint: "Бицепс", muscles: ["biceps"] },
  { match: /разгибан.*трицепс|французский жим|tricep/, title: "Упражнение на трицепс", hint: "Трицепс", muscles: ["triceps"] },
  { match: /икр|подъём на носки|подъем на носки|calf raise/, title: "Подъём на носки", hint: "Икроножные мышцы", muscles: ["calves"] },
  { match: /пресс|скручиван|планка|crunch|plank/, title: "Упражнение на пресс", hint: "Мышцы живота", muscles: ["abs"] },
];

function updateAnatomy(card) {
  const raw = card.querySelector(".exercise-name").value.trim();
  const found = exerciseMuscles.find((item) => item.match.test(raw));
  card.querySelector(".anatomy-title").textContent = found ? found.title : (raw ? "Упражнение не распознано" : "Выбери упражнение");
  card.querySelector(".anatomy-hint").textContent = found ? found.hint : (raw ? "Для него пока нет схемы мышц" : "Начни вводить название");
  card.querySelectorAll("[data-muscle]").forEach((muscle) => muscle.classList.toggle("active", Boolean(found?.muscles.includes(muscle.dataset.muscle))));
}

function addExercise(name = "") {
  const element = document.querySelector("#exercise-template").content.cloneNode(true);
  const card = element.querySelector(".exercise-card");
  const sets = card.querySelector(".sets");
  const nameInput = card.querySelector(".exercise-name");
  nameInput.value = name;
  nameInput.addEventListener("input", () => updateAnatomy(card));
  card.querySelector(".add-set").addEventListener("click", () => addSet(sets));
  card.querySelector(".remove-exercise").addEventListener("click", () => card.remove());
  addSet(sets);
  exerciseList.append(card);
  updateAnatomy(card);
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
