-- MultiTracker Avanzado: avisa al tracker (por log.txt) cuando el juego se pausa o sigue, para pausar el cronómetro.
-- El tracker ya lee log.txt; Isaac.DebugString escribe ahí «Lua Debug: MultiTracker: pause|resume».
local mod = RegisterMod("MultiTracker Pause", 1)
local game = Game()

-- Renders seguidos (~0,25 s) con el estado nuevo antes de avisar: así no cuentan los parpadeos.
local STABLE = 15
local shown, count = false, 0

-- Con REPENTOGON, el menú de pausa (abierto u opciones). Sin él, la pausa del juego, que también salta un momento
-- en algunas transiciones largas.
local function isPaused()
  if PauseMenu and PauseMenu.GetState then
    local ok, state = pcall(PauseMenu.GetState)
    if ok and state ~= nil then return state ~= 0 end
  end
  return game:IsPaused()
end

mod:AddCallback(ModCallbacks.MC_POST_RENDER, function()
  local paused = isPaused()
  if paused == shown then count = 0 return end
  count = count + 1
  if count < STABLE then return end
  shown, count = paused, 0
  Isaac.DebugString("MultiTracker: " .. (paused and "pause" or "resume"))
end)

-- Una partida nueva o continuada empieza sin pausa (el tracker ya sigue el tiempo al empezar).
mod:AddCallback(ModCallbacks.MC_POST_GAME_STARTED, function() shown, count = false, 0 end)
