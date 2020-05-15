import { Bot, Menu, Template } from "./bot";
import { getLanguage, getSumByRate } from "./util/utils";
import { ICustomers, IEmploeeByCustomer, IPaySlip, IAccDed } from "./types";
import { IData } from "./util/fileDB";

const vb = require('viber-bot');
const winston = require('winston');

const ViberBot = vb.Bot
const BotEvents = vb.Events
const TextMessage = vb.Message.Text;
const KeyboardMessage = vb.Message.Keyboard;

function createLogger() {
  const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    defaultMeta: { service: 'user-service' },
    transports: [
      //
      // - Write all logs with level `error` and below to `error.log`
      // - Write all logs with level `info` and below to `combined.log`
      //
      new winston.transports.File({ filename: 'error.log', level: 'error' }),
      new winston.transports.File({ filename: 'combined.log' })
    ]
  });

  //
  // If we're not in production then log to the `console` with the format:
  // `${info.level}: ${info.message} JSON.stringify({ ...rest }) `
  //
  if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
      format: winston.format.simple()
    }));
  }
	return logger;
}

export class Viber extends Bot {
  private _bot: any;

  constructor(token: string,
    getCustomers: () => ICustomers,
    getEmployeesByCustomer: (customerId: string) => IEmploeeByCustomer,
    getAccDeds: (customerId: string) => IData<IAccDed>,
    getPaySlipByUser: (customerId: string, userId: string) => IPaySlip | undefined) {

    super('viber', getCustomers, getEmployeesByCustomer, getAccDeds, getPaySlipByUser);


    const logger = createLogger();

    this._bot = new ViberBot({
      authToken: token,
     //logger: logger,
      name: 'Моя зарплата',
      avatar: ''
    });

    // this._bot.on(BotEvents.SUBSCRIBED, async (response: any) => {
    //   if (!response?.userProfile) {
    //     console.error('Invalid chat context');
    //   } else {
    //     this.start(response.userProfile.id.toString());
    //   }
    // });

    this._bot.onError((err: Error) => logger.error(err));

    this._bot.on(BotEvents.UNSUBSCRIBED, async (response: any) => {
      this.unsubscribe(response);
      logger.log(`User unsubscribed, ${response}`)
    });

    this._bot.on(BotEvents.CONVERSATION_STARTED, async (response: any, isSubscribed: boolean) => {
      if (!response?.userProfile) {
        console.error('Invalid chat context');
      } else {
        this.start(response.userProfile.id.toString(),
        `Здравствуйте${response?.userProfile.name ? ', ' + response.userProfile.name : ''}!\nДля подписки введите любое сообщение.`);
      }
    });

    this._bot.on(BotEvents.MESSAGE_RECEIVED, async (message: any, response: any) => {
      if (!response?.userProfile) {
        console.error('Invalid chat context');
      }
      else if (message?.text === undefined) {
        console.error('Invalid chat message');
      } else {
        this.process(response.userProfile.id.toString(), message.text);
      }
    });

    this._bot.on(BotEvents.MESSAGE_RECEIVED, async (message: any, response: any) => {

      if (!response?.userProfile) {
        console.error('Invalid chat context');
      }
      else if (message?.text === undefined) {
        console.error('Invalid chat callbackQuery');
      } else {
        this.callback_query(response.userProfile.id.toString(), getLanguage(response.userProfile.language), message.text);
      }
    });

    this._bot.onTextMessage(/login/, async (message: any, response: any) => {
      if (!response?.userProfile) {
        console.error('Invalid chat context');
      } else {
        this.loginDialog(response.userProfile.id.toString(), undefined, true);
      }
    });

    this._bot.onTextMessage(/logout/, async (message: any, response: any) => {
      if (!response?.userProfile) {
        console.error('Invalid chat context');
      } else {
        this.logout(response.userProfile.id.toString())
      }
    });

    this._bot.onTextMessage(/paySlip/, (message: any, response: any) => {
      if (!response?.userProfile) {
        console.error('Invalid chat context');
      } else {
        const today = new Date();
        const db = new Date(today.getFullYear(), today.getMonth(), 1);
        const de = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        this.paySlip(response.userProfile.id.toString(), 'CONCISE', getLanguage(response.userProfile.language), db, de);
      }
    });

    this._bot.onTextMessage(/detailPaySlip/, (message: any, response: any) => {
      if (!response?.userProfile) {
        console.error('Invalid chat context');
      } else {
        const today = new Date();
        const db = new Date(today.getFullYear(), today.getMonth(), 1);
        const de = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        this.paySlip(response.userProfile.id.toString(), 'DETAIL', getLanguage(response.userProfile.language), db, de);
      }
    });

    this._bot.onTextMessage(/concisePaySlip/, (message: any, response: any) => {
      if (!response?.userProfile) {
        console.error('Invalid chat context');
      } else {
        this.paySlipDialog(response.userProfile.id.toString(), getLanguage(response.userProfile.language), undefined, true);
      }
    });

    this._bot.onTextMessage(/comparePaySlip/, (message: any, response: any) => {
      if (!response?.userProfile) {
        console.error('Invalid chat context');
      } else {
        this.paySlipCompareDialog(response.userProfile.id.toString(), getLanguage(response.userProfile.language), undefined, true);
      }
    });

    this._bot.onTextMessage(/settings/, (message: any, response: any) => {
      if (!response?.userProfile) {
        console.error('Invalid chat context');
      } else {
        this.settings(response.userProfile.id.toString())
      }
    });

    this._bot.onTextMessage(/menu/, (message: any, response: any) => {
      if (!response?.userProfile) {
        console.error('Invalid chat context');
      } else {
        this.menu(response.userProfile.id.toString())
      }
    });

    this._bot.onTextMessage(/getCurrency/, (message: any, response: any) => {
      if (!response?.userProfile) {
        console.error('Invalid chat context');
      } else {
        this.currencyDialog(response.userProfile.id.toString(), getLanguage(response.userProfile.language), undefined, true);
      }
    });

    // this._bot.action('delete', ({ deleteMessage }) => deleteMessage());

  }

  get bot() {
    return this._bot;
  }

  private _menu2ViberMenu(menu: Menu) {
    const res: any[] = [];

    for (const row of menu) {
      let buttonWidth = Math.floor(6 / row.length);

      if (!buttonWidth) {
        buttonWidth = 1;
      }

      for (const col of row) {
        if (col.type === 'BUTTON') {
          res.push({
            Columns: buttonWidth,
            Rows: 1,
            ActionType: 'reply',
            ActionBody: col.command,
            Text: `<font color=\"#ffffff\">${col.caption}</font>`,
            BgColor: '#7360f2'
          });
        } else {
          res.push({
            Columns: buttonWidth,
            Rows: 1,
            ActionType: 'open-url',
            ActionBody: col.url,
            Text: `<font color=\"#ffffff\">${col.caption}</font>`,
            BgColor: '#7360f2'
          });
        }
      }
    }

    return {
      Type: 'keyboard',
      Buttons: res
    };
  }

  async editMessageReplyMarkup(chatId: string, menu: Menu) {
    await this._bot.sendMessage({ id: chatId }, [new KeyboardMessage(this._menu2ViberMenu(menu))]);
  }

  async deleteMessage(chatId: string) {

  }

  async sendMessage(chatId: string, message: string, menu?: Menu, markdown?: boolean) {
    try {
      if (menu) {
        await this._bot.sendMessage({ id: chatId }, [new TextMessage(message), new KeyboardMessage(this._menu2ViberMenu(menu))]);
      } else {
        await this._bot.sendMessage({ id: chatId }, [new TextMessage(message)]);
      }
    } catch(error) {
      if (error.status === 6) {
        console.log(`User is not subscribed. ChatId = ${chatId}`);
      } else {
        console.log(`Failed to send message. ChatId = ${chatId}`);
        console.log(error);
      }
    }
  }

  paySlipView(template: Template, rate: number) {
    const res = template.filter( t => t[0] !== '' && (t[1] !== 0 || t[1] === undefined )).map( t =>
      t[1] == undefined
        ? `${t[0] === '=' ? '===========================' : t[0]}`
        : t[2] !== undefined
          ? `${t[0]} ${new Intl.NumberFormat('ru-RU', { style: 'decimal', useGrouping: true, minimumFractionDigits: 2}).format(getSumByRate(t[1], rate))}`
          : `${t[0]} ${new Intl.NumberFormat('ru-RU', { style: 'decimal', useGrouping: true, minimumFractionDigits: 2}).format(t[1])}`
    ).join('\n');
    return res;
  }

  getPaySlipString(prevStr: string, name: string, s?: number) {
    const mas: string[] = [''];
    let i = 0;
    name.split(' ').filter(n => n !== '').forEach((s, xid) => {
      if (`${mas[i]} ${s}`.length <= 36)  {
        mas[i] = xid === 0 ? s : `${mas[i]} ${s}`
      } else {
        mas[i] = `${mas[i]}\n  `
        i = i + 1;
        mas[i] = s;
      }
    });
    const str = mas.join('');
    return `${prevStr}${s === 0 ? '' : prevStr !== '' ? '\n  ' + str  : '  ' + str}${s ? '\n  =' + new Intl.NumberFormat('ru-RU', { style: 'decimal', useGrouping: true, minimumFractionDigits: 2}).format(s) : ''}`
  }
};