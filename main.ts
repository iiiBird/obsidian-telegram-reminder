import { App, Plugin, PluginSettingTab, Setting } from 'obsidian'
import TelegramBot from 'node-telegram-bot-api'
import dayjs from 'dayjs'

interface PluginSettings {
  token: string
  chatId: number | undefined
  parseTime: number | undefined
  messagesData: Message[]
  firstNotice: number | undefined
  secondNotice: number | undefined
}

export interface Message {
  id: number
  check: boolean
  firstSend: boolean
  secondSend: boolean
  text: string
  date: Date
}

export interface TelegramMessage {
  chat: {
    id: number
  }
}

const DEFAULT_SETTINGS: PluginSettings = {
  token: '',
  chatId: undefined,
  parseTime: 5,
  messagesData: [],
  firstNotice: 1440,
  secondNotice: 120
}

let bot: TelegramBot
let dates: string[] = []
let messages: Message[] = []

export default class MyPlugin extends Plugin {
  settings: PluginSettings

  async onload() {
    console.log('Obsidian Telegram Reminder loaded')
    await this.loadSettings()

    this.addSettingTab(new SampleSettingTab(this.app, this))

    this.app.workspace.onLayoutReady(async () => {
      await this.findDates()
    })

    this.registerInterval(
      window.setInterval(async () => {
        await this.findDates()
      }, (this.settings.parseTime ? this.settings.parseTime : 5) * 60 * 1000)
    )

    if (bot) {
      if (bot.isPolling()) {
        await bot.stopPolling()
      }
    }

    this.registerInterval(
      window.setInterval(async () => {
        await this.initBot()
        await this.messagesPooling()
      }, 5 * 1000)
    )
  }

  async onunload() {
    if (bot && bot.isPolling()) {
      await bot.stopPolling()
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
  }

  async saveSettings() {
    await this.saveData(this.settings)
  }

  async findDates() {
    dates = []
    const { vault } = this.app

    const fileContents: string[] = await Promise.all(vault.getMarkdownFiles().map(file => vault.cachedRead(file)))

    fileContents.forEach(content => {
      const regex = /^(?<prefix>((> ?)*)?\s*[-*][ ]+\[)(?<check>.)(?<suffix>\]\s+)(?<body>.*)$/gim
      const matchResult = content.match(regex)
      if (matchResult !== null) {
        dates.push(...matchResult)
      }
    })
  }

  async initBot() {
    if (!this.settings.token) {
      console.log('Insert telegram token')
      return
    }
    if (!bot) {
      bot = new TelegramBot(this.settings.token.trim())
      bot.on('polling_error', console.log)
    }

    if (this.settings.chatId) {
      if (bot.isPolling()) {
        await bot.stopPolling()
      }
    } else {
      await bot.startPolling()

      bot.on('message', function (message: TelegramMessage) {
        bot.sendMessage(message.chat.id, `Your chat id: ${message.chat.id}. Insert in plugin settings`)
      })
    }
  }

  async sendMessage(text: string) {
    if (!bot) {
      return
    }
    if (!this.settings.chatId) {
      return
    }

    await bot.sendMessage(this.settings.chatId, text)
  }

  addDefaultTime(dateTimeString: string) {
    const dateTimeParts = dateTimeString.split(' ')
    const datePart = dateTimeParts[0]
    let timePart = dateTimeParts[1]

    if (timePart === undefined) {
      timePart = '09:00'
    }

    return datePart + ' ' + timePart
  }

  async messagesPooling() {
    messages = []

    dates.forEach(item => {
      const regex = /^(?<prefix>((> ?)*)?\s*[-*][ ]+\[)(?<check>.)(?<suffix>\]\s+)(?<body>.*)$/
      const regexBody = /^(?<title1>.*?)\(@(?<time>.+?)\)(?<title2>.*)$/
      const found = regex.exec(item)

      if (found && found.groups && found.groups.body) {
        const check = found.groups.check === 'x'
        const body = regexBody.exec(found.groups.body)

        if (body && body.groups) {
          const dateString = body.groups.time.replace('[[', '').replace(']]', '')
          const text = `${body.groups.title1} — ${this.addDefaultTime(dateString)}`
          const date = new Date(this.addDefaultTime(dateString))
          const id = Date.parse(this.addDefaultTime(dateString))

          if (dayjs().isBefore(date)) {
            messages.push({
              id,
              text,
              check,
              date,
              firstSend: false,
              secondSend: false
            })
          }
        }
      }
    })

    messages.forEach(message => {
      if (!this.settings.messagesData.some(obj => obj.id === message.id)) {
        this.settings.messagesData.push(message)
      }
    })

    await Promise.all(
      this.settings.messagesData.map(async message => {
        await this.sendHandler(message)
      })
    )
  }

  async sendHandler(message: Message) {
    if (message.check) {
      return
    }
    if (this.settings.firstNotice === this.settings.secondNotice) {
      message.secondSend = true
      this.settings.messagesData.forEach(item => {
        if (item.id === message.id) {
          item.secondSend = true
        }
      })
      await this.saveSettings()
    }
    if (!message.firstSend) {
      await this.sending('first', message)
    }
    if (!message.secondSend) {
      await this.sending('second', message)
    }
  }

  async sending(type: string, message: Message) {
    const defaultMinutes = 60
    const minutes =
      type === 'first'
        ? this.settings.firstNotice || defaultMinutes
        : type === 'second'
        ? this.settings.secondNotice || defaultMinutes
        : defaultMinutes

    if (dayjs().isAfter(dayjs(message.date).subtract(minutes, 'minutes'))) {
      try {
        await this.sendMessage(message.text)
        this.settings.messagesData.forEach(item => {
          if (item.id === message.id) {
            if (type === 'first') {
              item.firstSend = true
            } else if (type === 'second') {
              item.secondSend = true
            }
          }
        })
        await this.saveSettings()
      } catch (e) {
        console.error(e)
      }
    }
  }
}

class SampleSettingTab extends PluginSettingTab {
  plugin: MyPlugin

  constructor(app: App, plugin: MyPlugin) {
    super(app, plugin)
    this.plugin = plugin
  }

  display(): void {
    const { containerEl } = this

    containerEl.empty()

    containerEl.createEl('h2', { text: 'Settings' })

    new Setting(containerEl)
      .setName('Telegram Bot Token')
      .setDesc(
        `Create a Telegram bot using https://t.me/botfather and obtain the token.
         After entering the token, send any message to your bot. You will receive a chat ID in response.`
      )
      .addText(text =>
        text
          .setPlaceholder('Enter your token')
          .setValue(this.plugin.settings.token)
          .onChange(async value => {
            this.plugin.settings.token = value
            await this.plugin.saveSettings()
          })
      )

    new Setting(containerEl)
      .setName('Сhat ID')
      .setDesc('After entering the token, send any message to your bot. You will receive a chat ID in response.')
      .addText(text =>
        text
          .setPlaceholder('Enter your chatId')
          .setValue(this.plugin.settings.chatId ? this.plugin.settings.chatId.toString() : '')
          .onChange(async value => {
            if (isNaN(parseInt(value))) {
              value = ''
            }
            this.plugin.settings.chatId = parseInt(value)
            await this.plugin.saveSettings()
          })
      )

    new Setting(containerEl)
      .setName('Parsing time')
      .setDesc('The interval (in minutes) at which new dates for notifications will be parsed.')
      .addText(text =>
        text
          .setPlaceholder('Enter parsing time')
          .setValue(this.plugin.settings.parseTime ? this.plugin.settings.parseTime.toString() : '')
          .onChange(async value => {
            if (parseInt(value) < 1 || isNaN(parseInt(value))) {
              value = '1'
            }
            this.plugin.settings.parseTime = parseInt(value)
            await this.plugin.saveSettings()
          })
      )

    new Setting(containerEl)
      .setName('First notice')
      .setDesc('The number of minutes before the event to send the first notification.')
      .addText(text =>
        text
          .setPlaceholder('Enter first notice time')
          .setValue(this.plugin.settings.firstNotice ? this.plugin.settings.firstNotice.toString() : '')
          .onChange(async value => {
            if (parseInt(value) < 1 || isNaN(parseInt(value))) {
              value = '1'
            }
            this.plugin.settings.firstNotice = parseInt(value)
            await this.plugin.saveSettings()
          })
      )

    new Setting(containerEl)
      .setName('Second notice')
      .setDesc('The number of minutes before the event to send the second notification.')
      .addText(text =>
        text
          .setPlaceholder('Enter second notice time')
          .setValue(this.plugin.settings.secondNotice ? this.plugin.settings.secondNotice.toString() : '')
          .onChange(async value => {
            if (parseInt(value) < 1 || isNaN(parseInt(value))) {
              value = '1'
            }
            this.plugin.settings.secondNotice = parseInt(value)
            await this.plugin.saveSettings()
          })
      )

    new Setting(containerEl)
      .setName('Clear cache')
      .setDesc('Clear the cache of dates and sent marks.')
      .addButton(button => {
        button.setButtonText('Clear cache')
        button.onClick(async () => {
          this.plugin.settings.messagesData = []
          await this.plugin.saveSettings()
        })
      })
  }
}
