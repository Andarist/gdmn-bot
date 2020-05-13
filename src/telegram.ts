import { Bot, Menu, Template } from "./bot";
import Telegraf, { Context, Extra, Markup } from "telegraf";
import { getLanguage, getSumByRate } from "./util/utils";
import { ICustomers, IEmploeeByCustomer, IPaySlip, IAccDed } from "./types";
import { IData } from "./util/fileDB";

export class TelegramBot extends Bot {
  private _bot: Telegraf<Context>;

  constructor(token: string,
    getCustomers: () => ICustomers,
    getEmployeesByCustomer: (customerId: string) => IEmploeeByCustomer,
    getAccDeds: (customerId: string) => IData<IAccDed>,
    getPaySlipByUser: (customerId: string, userId: string) => IPaySlip | undefined) {

    super('telegram', getCustomers, getEmployeesByCustomer, getAccDeds, getPaySlipByUser);

    this._bot = new Telegraf(token);

    this._bot.use((ctx, next) => {
      console.log(`Chat ${ctx.chat?.id}: ${ctx.updateType} ${ctx.message?.text !== undefined ? ('-- ' + ctx.message?.text) : ''}`);
      return next?.();
    });

    this._bot.start(
      ctx => {
        if (!ctx.chat) {
          console.error('Invalid chat context');
        } else {
          this.start(ctx.chat.id.toString(), 'Для получения информации о заработной плате необходимо зарегистрироваться в системе.');
        }
      }
    );

    this._bot.on('message',
      ctx => {
        if (!ctx.chat) {
          console.error('Invalid chat context');
        }
        else if (ctx.message?.text === undefined) {
          console.error('Invalid chat message');
        } else {
          this.process(ctx.chat.id.toString(), ctx.message.text);
        }
      }
    );

    /**
     * Регистрация в системе. Привязка ИД телеграма к учетной записи
     * в системе расчета зарплаты.
     */
    this._bot.action('login',
      ctx => {
        if (!ctx.chat) {
          console.error('Invalid chat context');
        } else {
          this.loginDialog(ctx.chat.id.toString(), undefined, true);
        }
      });

    this._bot.action('logout',
      async (ctx) => {
        if (!ctx.chat) {
          console.error('Invalid chat context');
        } else {
          this.logout(ctx.chat.id.toString())
        }
      });

    this._bot.action('paySlip',
      ctx => {
        if (!ctx.chat) {
          console.error('Invalid chat context');
        } else {
          const today = new Date();
          const db = new Date(today.getFullYear(), today.getMonth(), 1);
          const de = new Date(today.getFullYear(), today.getMonth() + 1, 0);
          this.paySlip(ctx.chat.id.toString(), 'CONCISE', getLanguage(ctx.from?.language_code), db, de);
        }
      });

    this._bot.action('detailPaySlip',
      ctx => {
        if (!ctx.chat) {
          console.error('Invalid chat context');
        } else {
          const today = new Date();
          const db = new Date(today.getFullYear(), today.getMonth(), 1);
          const de = new Date(today.getFullYear(), today.getMonth() + 1, 0);
          this.paySlip(ctx.chat.id.toString(), 'DETAIL', getLanguage(ctx.from?.language_code), db, de);
        }
      });

    this._bot.action('concisePaySlip',
      ctx => {
        if (!ctx.chat) {
          console.error('Invalid chat context');
        } else {
          this.paySlipDialog(ctx.chat.id.toString(), getLanguage(ctx.from?.language_code), undefined, true);
        }
      });

    this._bot.action('comparePaySlip',
      ctx => {
        if (!ctx.chat) {
          console.error('Invalid chat context');
        } else {
          this.paySlipCompareDialog(ctx.chat.id.toString(), getLanguage(ctx.from?.language_code), undefined, true);
        }
      });

    this._bot.action('settings',
      ctx => {
        if (!ctx.chat) {
          console.error('Invalid chat context');
        } else {
          this.settings(ctx.chat.id.toString())
        }
      });

    this._bot.action('menu',
      ctx => {
        if (!ctx.chat) {
          console.error('Invalid chat context');
        } else {
          this.menu(ctx.chat.id.toString())
        }
      });

    this._bot.action('getCurrency',
      ctx => {
        if (!ctx.chat) {
          console.error('Invalid chat context');
        } else {
          this.currencyDialog(ctx.chat.id.toString(), getLanguage(ctx.from?.language_code), undefined, true);
        }
      });

    this._bot.on('callback_query',
      ctx => {
        if (!ctx.chat) {
          console.error('Invalid chat context');
        }
        else if (ctx.callbackQuery?.data === undefined) {
          console.error('Invalid chat callbackQuery');
        } else {
          this.callback_query(ctx.chat.id.toString(), getLanguage(ctx.from?.language_code), ctx.callbackQuery?.data);
        }
      });

    this._bot.action('delete', ({ deleteMessage }) => deleteMessage());

    this._bot.launch();
  }

  get bot() {
    return this._bot;
  }

  private menu2markup(menu: Menu) {
    return Markup.inlineKeyboard(
      menu.map(r => r.map(
        c => c.type === 'BUTTON'
          ? Markup.callbackButton(c.caption, c.command) as any
          : Markup.urlButton(c.caption, c.url)
      ))
    );
  }

  paySlipView(template: Template, rate: number) {
    const lenS = 10;
    const len = 19;
    const res = template.filter( t => t[0] !== '' && (t[1] !== 0 || t[1] === undefined )).map(t =>
      t[1] === undefined
        ? `${t[0] === '=' ? '==============================' : t[0]}`
        : t[2] !== undefined
          ? `${t[0].toString().padEnd(len)} ${new Intl.NumberFormat('ru-RU', { style: 'decimal', useGrouping: true, minimumFractionDigits: 2}).format(getSumByRate(t[1], rate)).padStart(lenS)}`
          : `${t[0].toString().padEnd(len)} ${new Intl.NumberFormat('ru-RU', { style: 'decimal', useGrouping: true, minimumFractionDigits: 2}).format(t[1]).padStart(lenS)}`
    ).join('\n');
    return (
      `${'`'}${'`'}${'`'}ini
${res}
${'`'}${'`'}${'`'}`
    );
  }

  async editMessageReplyMarkup(chatId: string, menu: Menu, userProfile?: any) {
    const dialogState = this.dialogStates.read(chatId);
    if (dialogState) {
      if (dialogState.menuMessageId) {
        try {
          this.bot.telegram.editMessageReplyMarkup(chatId, dialogState.menuMessageId, undefined, JSON.stringify(this.menu2markup(menu)));
        }
        catch (e) {
          // FIXME: error
          //
          // TODO: если сообщение уже было удалено из чата, то
          // будет ошибка, которую мы подавляем.
          // В будущем надо ловить события удаления сообщения
          // и убирать его ИД из сохраненных данных
        }
      }
    }
  }

  async deleteMessage(chatId: string) {
    const dialogState = this.dialogStates.read(chatId);
    if (dialogState) {
      if (dialogState.menuMessageId) {
        try {
          await this.bot.telegram.deleteMessage(chatId, dialogState.menuMessageId);
        }
        catch (e) {
          // TODO: если сообщение уже было удалено из чата, то
          // будет ошибка, которую мы подавляем.
          // В будущем надо ловить события удаления сообщения
          // и убирать его ИД из сохраненных данных
        }
      }
    }
  }

  async sendMessage(chatId: string, message: string, menu?: Menu, markdown?: boolean, userProfile?: any) {
    // const m = markdown
    //   ? await this.bot.telegram.sendMessage(chatId, message, menu && { parse_mode: 'MarkdownV2', ...Extra.markup(this.menu2markup(menu)) })
    //   : await this.bot.telegram.sendMessage(chatId, message, menu && Extra.markup(this.menu2markup(menu)));
    const dialogState = this.dialogStates.read(chatId);
    let m;
    try {
      m = markdown
        ? await this.bot.telegram.sendMessage(chatId, message, menu && { parse_mode: 'MarkdownV2', ...Extra.markup(this.menu2markup(menu)) })
        : await this.bot.telegram.sendMessage(chatId, message, menu && Extra.markup(this.menu2markup(menu)));

      if (dialogState) {
        if (dialogState.menuMessageId) {
          try {
            await this.bot.telegram.editMessageReplyMarkup(chatId, dialogState.menuMessageId);
          }
          catch (e) {
            // TODO: если сообщение уже было удалено из чата, то
            // будет ошибка, которую мы подавляем.
            // В будущем надо ловить события удаления сообщения
            // и убирать его ИД из сохраненных данных
          }
        }

        if (menu) {
          this.dialogStates.merge(chatId, { menuMessageId: m.message_id });
        } else {
          this.dialogStates.merge(chatId, { menuMessageId: undefined });
        }
      }
    }
    catch(error) {
      if (error.response && error.code === 403) {
        console.log(`Bot was blocked by the user. ChatId = ${chatId}`);
         this.dialogStates.delete(chatId);
      } else {
        console.log(`Failed to send message. ChatId = ${chatId}`);
        console.log(error);
      }
    }
  }

 getPaySlipString(prevStr: string, name: string, s?: number) {
    const mas: string[] = [''];
    let i = 0;
    name.split(' ').filter(n => n !== '').forEach((s, xid) => {
      if (`${mas[i]} ${s}`.length <= 28)  {
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