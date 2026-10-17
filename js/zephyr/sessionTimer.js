// Zephyr Session Timer Module
const sessionTimer = {
  startTime: null,
  timerElement: null,
  intervalId: null,

  initialize: function () {
    this.timerElement = document.getElementById('timer')
    if (!this.timerElement) {
      return
    }

    // Start timer when browser launches
    this.startTime = Date.now()
    this.updateTimer()

    // Update every second
    this.intervalId = setInterval(() => {
      this.updateTimer()
    }, 1000)
  },

  updateTimer: function () {
    if (!this.timerElement || !this.startTime) {
      return
    }

    const elapsed = Math.floor((Date.now() - this.startTime) / 1000)
    const minutes = Math.floor(elapsed / 60)
    const seconds = elapsed % 60

    const formattedTime = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    this.timerElement.textContent = formattedTime
  },

  reset: function () {
    this.startTime = Date.now()
    this.updateTimer()
  },

  destroy: function () {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }
}

module.exports = sessionTimer
