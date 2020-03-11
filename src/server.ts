import Koa from "koa";
import bodyParser from 'koa-bodyparser';
import Router from 'koa-router';
import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import Telegraf, { Extra, Markup, ContextMessageUpdate } from 'telegraf';
import { IAccountLink, IDialogStateLoggingIn, DialogState, ICustomer, IEmployee, IAccDed, IPaySlip, IPaySlipItem } from "./types";
import { FileDB } from "./fileDB";
import { normalizeStr, getLanguage, getLName, getPaySlipString } from "./utils";
import { InlineKeyboardMarkup } from "telegraf/typings/telegram-types";

const cListok =
`${'`'}${'`'}${'`'}ini
Начислено:           726.87
===========================
Зарплата (чистыми):  617.84
  К выдаче:          502.12
  Удержания:         115.72
===========================
Налоги:              109.03
  Подоходный:         94.49
  Пенсионный:          7.27
  Профсоюзный:         7.27
===========================
Информация:
  Участок глубокой печати моф (угп моф)
  Клеевар
  Оклад:             450.24
${'`'}${'`'}${'`'}`;

/**
 * Связь между ИД чата и человеком, сотрудником предприятия.
 */
const accountLink = new FileDB<IAccountLink>(path.resolve(process.cwd(), 'data/accountlink.json'), {});
const dialogStates = new FileDB<DialogState>(path.resolve(process.cwd(), 'data/dialogstates.json'), {});
const customers = new FileDB<Omit<ICustomer, 'id'>>(path.resolve(process.cwd(), 'data/customers.json'), {});
const employeesByCustomer: { [customerId: string]: FileDB<Omit<IEmployee, 'id'>> } = {};

/**
 * справочники начислений/удержаний для каждого клиента.
 * ключем объекта выступает РУИД записи из базы Гедымина.
 */
const customerAccDeds: { [customerID: string]: FileDB<IAccDed> } = {};

/**
 * Расчетные листки для каждого клиента.
 * Ключем объекта выступает персональный номер из паспорта.
 */
const paySlips: { [employeeId: string]: FileDB<IPaySlip> } = {};
//const paySlipsByEmploeeYear: { [employeeId: string]: FileDB<IPaySlip> } = {};

let app = new Koa();
let router = new Router();

const config = {
  domain: 'gs.selfip.biz',
  https: {
    port: 8443,
    options: {
      key: fs.readFileSync(path.resolve(process.cwd(), 'cert/gsbot-key.pem'), 'utf8').toString(),
      cert: fs.readFileSync(path.resolve(process.cwd(), 'cert/gsbot-cert.pem'), 'utf8').toString(),
    },
  },
};

router.get('/load', (ctx, next) => {
  // ctx.router available
  load(ctx);
  next();
});

const load = (ctx: any) => {
  ctx.body = 'Hello World!';
}

router.get('/', (ctx, next) => {
  ctx.body = 'Hello World!';
  next();
});

router.post('/upload', (ctx, next) => {
  upload(ctx);
  next();
});

const upload = (ctx: any) => {
  const { dataType, customerId, objData } = ctx.request.body;
  switch (dataType) {
    //Если тип загружаемых данных - Справочники видов начислений\удержаний
    case 'accDedRef': {
      let customerAccDed = customerAccDeds[customerId];

      if (!customerAccDed) {
        customerAccDed = new FileDB<IAccDed>(path.resolve(process.cwd(), `data/payslip.${customerId}/accdedref.json`), {});
        customerAccDeds[customerId] = customerAccDed;
      } else {
        //customerAccDed.clear;
      }
      customerAccDed.clear;

      for (const [key, value] of Object.entries(objData)) {
        customerAccDed.write(key, value as any);
      }

      customerAccDed.flush();
    }
    //Если тип загружаемых данных - Расчетные листки по сотрудникам в разрезе года
    case 'paySlip': {
      let paySlip: FileDB<IPaySlip>;
      for (const [key, value] of Object.entries(objData) as any) {
        const employeeId = value.employeeId;
        const year = value.year;

        paySlip = paySlips[employeeId];

        if (!paySlip || paySlip.getMutable(false).year !== year) {
          paySlip = new FileDB<IPaySlip>(path.resolve(process.cwd(), `data/payslip.${customerId}/${year}/payslip.${customerId}.${employeeId}.${year}.json`), {});
          paySlips[employeeId] = paySlip;
        } else {
          paySlip.clear;
        }

        paySlip.write('employeeId', value.employeeId);
        paySlip.write('year', value.year);
        paySlip.write('deptName', value.deptName);
        paySlip.write('posName', value.posName);
        paySlip.write('hiringDate', value.hiringDate);
        paySlip.write('data', value.data);
        paySlip.flush();
      }
    }
  }
  ctx.status = 200;
  ctx.body = JSON.stringify({ status: 200, result: `ok` });
}

app
  .use(bodyParser())
  .use(router.routes())
  .use(router.allowedMethods());

const serverCallback = app.callback();

http.createServer(serverCallback).listen(3000);
https.createServer(config.https.options, serverCallback).listen(config.https.port);

const withMenu = async (ctx: ContextMessageUpdate, msg: string, menu?: Markup & InlineKeyboardMarkup, markdown?: boolean) => {
  if (!ctx.chat) {
    throw new Error('Invalid context');
  }

  const m = markdown
    ? await ctx.reply(msg, menu && { parse_mode: 'MarkdownV2', ...Extra.markup(menu) })
    : await ctx.reply(msg, menu && Extra.markup(menu));

  const chatId = ctx.chat.id.toString();
  const dialogState = dialogStates.read(chatId);

  if (dialogState) {
    if (dialogState.menuMessageId) {
      try {
        await bot.telegram.editMessageReplyMarkup(ctx.chat.id, dialogState.menuMessageId);
      }
      catch (e) {
        // TODO: если сообщение уже было удалено из чата, то
        // будет ошибка, которую мы подавляем.
        // В будущем надо ловить события удаления сообщения
        // и убирать его ИД из сохраненных данных
      }
    }

    if (menu) {
      dialogStates.merge(chatId, { menuMessageId: m.message_id });
    } else {
      dialogStates.merge(chatId, { menuMessageId: undefined });
    }
  }
};

const loginDialog = async (ctx: ContextMessageUpdate, start = false) => {
  if (!ctx.chat) {
    throw new Error('Invalid context');
  }

  const chatId = ctx.chat.id.toString();

  if (start) {
    await withMenu(ctx, 'Для регистрации в системе введите указанные данные.');
    dialogStates.merge(chatId, { type: 'LOGGING_IN', lastUpdated: new Date().getTime(), employee: {} });
  }

  const dialogState = dialogStates.getMutable(true)[chatId];

  if (!dialogState || dialogState.type !== 'LOGGING_IN') {
    throw new Error('Invalid dialog state');
  }

  const text = start ? '' : normalizeStr(ctx.message?.text);
  const { employee } = dialogState as IDialogStateLoggingIn;

  if (text) {
    if (!employee.customerId) {
      const found = Object.entries(customers.getMutable(false)).find( ([_, c]) =>
        normalizeStr(c.name) === text || c.aliases.find(
          a => normalizeStr(a) === text
        )
      );

      if (found) {
        employee.customerId = found[0];
      } else {
        await withMenu(ctx, '😕 Такого предприятия нет в базе данных!', keyboardLogin);
        dialogStates.merge(chatId, { type: 'INITIAL', lastUpdated: new Date().getTime() }, ['employee']);
        return;
      }
    }
    else if (!employee.firstName) {
      employee.firstName = text;
    }
    else if (!employee.lastName) {
      employee.lastName = text;
    }
    else if (!employee.patrName) {
      employee.patrName = text;
    }
    else if (!employee.passportId) {
      employee.passportId = text;
    }
    else if (!employee.tabNumber) {
      employee.tabNumber = text;
    }
  }

  if (employee.tabNumber && employee.customerId) {
    let employees = employeesByCustomer[employee.customerId];

    if (!employees) {
      employees = new FileDB<IEmployee>(path.resolve(process.cwd(), `data/employee.${employee.customerId}.json`), {});
      employeesByCustomer[employee.customerId] = employees;
    }

    const found = Object.entries(employees.getMutable(false)).find(
      ([_, e]) =>
        normalizeStr(e.firstName) === employee.firstName
        &&
        normalizeStr(e.lastName) === employee.lastName
        &&
        normalizeStr(e.patrName) === employee.patrName
        &&
        normalizeStr(e.passportId) === employee.passportId
        &&
        normalizeStr(e.tabNumber) === employee.tabNumber
    );

    if (found) {
      accountLink.merge(chatId, {
        customerId: employee.customerId,
        employeeId: found[0]
      });
      accountLink.flush();
      dialogStates.merge(chatId, { type: 'LOGGED_IN', lastUpdated: new Date().getTime() }, ['employee']);
      withMenu(ctx, '🏁 Регистрация прошла успешно.', keyboardMenu);
    } else {
      withMenu(ctx,
`
Сотрудник не найден в базе данных.

Обратитесь в отдел кадров или повторите регистрацию.

Были введены следующие данные:
Предприятие: ${employee.customerId}
Имя: ${employee.firstName}
Фамилия: ${employee.lastName}
Отчество: ${employee.patrName}
Идентификационный номер: ${employee.passportId}
Табельный номер: ${employee.tabNumber}
`, keyboardLogin);

      dialogStates.merge(chatId, { type: 'INITIAL', lastUpdated: new Date().getTime() }, ['employee']);
    }
  } else {
    if (!employee.customerId) {
      withMenu(ctx, 'Введите название предприятия:');
    }
    else if (!employee.firstName) {
      withMenu(ctx, 'Введите имя:');
    }
    else if (!employee.lastName) {
      withMenu(ctx, 'Введите фамилию:');
    }
    else if (!employee.patrName) {
      withMenu(ctx, 'Введите отчество:');
    }
    else if (!employee.passportId) {
      withMenu(ctx, 'Введите идентификационный номер из паспорта:');
    }
    else if (!employee.tabNumber) {
      withMenu(ctx, 'Введите табельный номер из расчетного листка:');
    }
  }
};

const keyboardLogin = Markup.inlineKeyboard([
  Markup.callbackButton('✏ Зарегистрироваться', 'login') as any,
  Markup.urlButton('❓', 'http://gsbelarus.com'),
]);

const keyboardMenu = Markup.inlineKeyboard([
  [Markup.callbackButton('💰 Расчетный листок', 'paySlip') as any,
  Markup.callbackButton('💰 Подробный листок', 'detailPaySlip') as any],
  [
    Markup.callbackButton('🚪 Выйти', 'logout') as any,
    Markup.urlButton('❓', 'http://gsbelarus.com')
  ]
]);

if (typeof process.env.GDMN_BOT_TOKEN !== 'string') {
  throw new Error('GDMN_BOT_TOKEN env variable is not specified.');
}

const bot = new Telegraf(process.env.GDMN_BOT_TOKEN);

bot.use( (ctx, next) => {
  console.log(`Chat ${ctx.chat?.id}: ${ctx.updateType} ${ctx.message?.text !== undefined ? ('-- ' + ctx.message?.text) : ''}`);
  return next && next();
});


/**
 * При старте бота проверяем этот пользователь уже привязан
 * к учетной записи сотрудника предприятия или нет.
 *
 * Если нет, то предлагаем пройти регистрацию.
 *
 * Если да, то выводим меню с дальнейшими действиями.
 */
bot.start(
  ctx => {

    if (!ctx.chat) {
      withMenu(ctx, 'Error: Invalid chat Id');
    } else {
      const chatId = ctx.chat.id.toString();
      const link = accountLink.read(chatId);

      if (!link) {
        dialogStates.merge(chatId, { type: 'INITIAL', lastUpdated: new Date().getTime() });
        withMenu(ctx,
          'Приветствуем! Для получения информации о заработной плате необходимо зарегистрироваться в системе.',
          keyboardLogin);
      } else {
        dialogStates.merge(chatId, { type: 'LOGGED_IN', lastUpdated: new Date().getTime() });
        withMenu(ctx,
          'Здраствуйте! Вы зарегистрированы в системе. Выберите одно из предложенных действий.',
          keyboardMenu);
      }
    }
  }
);

bot.help( ctx => withMenu(ctx, 'Help message') );

bot.on('message', async (ctx) => {
  if (ctx.chat) {
    const chatId = ctx.chat.id.toString();
    const dialogState = dialogStates.read(chatId);

    if (dialogState?.type === 'LOGGING_IN') {
      loginDialog(ctx);
    }
    else if (dialogState?.type === 'LOGGED_IN') {
      if (ctx.message?.text === 'организации') {
        ctx.reply(Object.values(customers).map( c => c.name).join(', '));
        ctx.reply(ctx.chat.id.toString());
        ctx.reply(ctx.from!.id.toString());
        ctx.reply(ctx.from!.username!);
      } else {
        withMenu(ctx,
`
🤔 Ваша команда непонятна.

Выберите одно из предложенных действий.
`, keyboardMenu);
      }
    }
    else {
      withMenu(ctx,
        'Для получения информации о заработной плате необходимо зарегистрироваться в системе.',
        keyboardLogin);
    }
  }
});

/**
 * Регистрация в системе. Привязка ИД телеграма к учетной записи
 * в системе расчета зарплаты.
 */
bot.action('login', ctx => {
  if (ctx.chat) {
    loginDialog(ctx, true);
  }
});

bot.action('logout', async (ctx) => {
  if (ctx.chat) {
    await withMenu(ctx, '💔 До свидания!', keyboardLogin);
    const chatId = ctx.chat.id.toString();
    accountLink.delete(chatId);
    dialogStates.merge(chatId, { type: 'INITIAL', lastUpdated: new Date().getTime() }, ['employee']);
  }
});

bot.action('paySlip', ctx => {
  console.log('paySlip');
  if (ctx.chat) {
    const chatId = ctx.chat.id.toString();
    const link = accountLink.read(chatId);
    if (link?.customerId && link.employeeId) {
      const {customerId, employeeId} = link;

      let empls = employeesByCustomer[customerId];
      if (!empls) {
        empls = new FileDB<IEmployee>(path.resolve(process.cwd(), `data/employee.${customerId}.json`), {});
        employeesByCustomer[customerId] = empls;
      };

      const passportId = empls.getMutable(false)[employeeId].passportId;

      if (passportId) {

        let paySlip = paySlips[passportId];
        const today = new Date();
        if (!paySlip) {
          const year = today.getFullYear()-1;
          paySlip = new FileDB<IPaySlip>(path.resolve(process.cwd(), `data/payslip.${customerId}/${year}/payslip.${customerId}.${passportId}.${year}.json`), {});
          paySlips[passportId] = paySlip;
        };

        const db = new Date(today.getFullYear()-1, today.getMonth() + 1, 1);
        const de = new Date(today.getFullYear()-1, today.getMonth() + 2, 0);

        let accDed = customerAccDeds[customerId];
        if (!accDed) {
          accDed = new FileDB<IAccDed>(path.resolve(process.cwd(), `data/payslip.${customerId}/accdedref.json`), {});
          customerAccDeds[customerId] = accDed;
        };

        const accDedObj = accDed.getMutable(false);
        const paySlipObj = paySlip.getMutable(false);

        if (Object.keys(paySlipObj).length === 0) {
          withMenu(ctx,
            `Нет расчетного листка за период ${db.toLocaleDateString()} - ${de.toLocaleDateString()}!`,
            keyboardMenu);
        } else {

          let accrual = 0, salary = 0, tax = 0, ded = 0, saldo = 0, incomeTax = 0, pensionTax = 0, tradeUnionTax = 0, advance = 0;
          for (const [key, value] of Object.entries(paySlipObj.data) as any) {
            if (new Date(value.dateBegin) >= db && new Date(value.dateEnd) <= de) {
              if (value.typeId === 'saldo') {
                saldo = saldo + value.s;
              } else if (value.typeId === 'salary') {
                salary = value.s;
              } else if (accDedObj[value.typeId]) {
                switch (accDedObj[value.typeId].type) {
                  case 'INCOME_TAX': {
                    incomeTax = incomeTax + value.s;
                    break;
                  }
                  case 'PENSION_TAX': {
                    pensionTax = pensionTax + value.s;
                    break;
                  }
                  case 'TRADE_UNION_TAX': {
                    tradeUnionTax = tradeUnionTax + value.s;
                    break;
                  }
                  case 'ADVANCE': {
                    advance = advance + value.s;
                    break;
                  }
                  case 'DEDUCTION': {
                    ded = ded + value.s;
                    break;
                  }
                  case 'TAX': {
                    tax = tax + value.s;
                    break;
                  }
                  case 'ACCRUAL': {
                    accrual = accrual + value.s;
                    break;
                  }

                }
              }
            }
          };

          const taxes = incomeTax + pensionTax + tradeUnionTax;
          const deptName = paySlipObj.deptName;
          const posName = paySlipObj.posName;

          const cListok =
            `${'`'}${'`'}${'`'}ini
            Начислено:           ${accrual.toFixed(2)}
            ===========================
            Зарплата (чистыми):  ${(accrual - taxes).toFixed(2)}
              Аванс:             ${advance.toFixed(2)}
              К выдаче:          ${saldo.toFixed(2)}
              Удержания:         ${ded.toFixed(2)}
            ===========================
            Налоги:              ${taxes.toFixed(2)}
              Подоходный:        ${incomeTax.toFixed(2)}
              Пенсионный:        ${pensionTax.toFixed(2)}
              Профсоюзный:       ${tradeUnionTax.toFixed(2)}
            ===========================
            Информация:
              ${deptName}
              ${posName}
              Оклад:             ${salary.toFixed(2)}
            ${'`'}${'`'}${'`'}`;
            withMenu(ctx, cListok, keyboardMenu, true);
        }
      }
    }
  }
});

bot.action('detailPaySlip', ctx => {

  if (ctx.chat) {
    const chatId = ctx.chat.id.toString();
    const link = accountLink.read(chatId);
    if (link?.customerId && link.employeeId) {
      const {customerId, employeeId} = link;

      let empls = employeesByCustomer[customerId];
      if (!empls) {
        empls = new FileDB<IEmployee>(path.resolve(process.cwd(), `data/employee.${customerId}.json`), {});
        employeesByCustomer[customerId] = empls;
      };

      const passportId = empls.getMutable(false)[employeeId].passportId;

      if (passportId) {

        let paySlip = paySlips[passportId];
        const today = new Date();
        if (!paySlip) {
          const year = today.getFullYear()-1;
          paySlip = new FileDB<IPaySlip>(path.resolve(process.cwd(), `data/payslip.${customerId}/${year}/payslip.${customerId}.${passportId}.${year}.json`), {});
          paySlips[passportId] = paySlip;
        };

        const db = new Date(today.getFullYear()-1, today.getMonth() + 1, 1);
        const de = new Date(today.getFullYear()-1, today.getMonth() + 2, 0);

        let accDed = customerAccDeds[customerId];
        if (!accDed) {
          accDed = new FileDB<IAccDed>(path.resolve(process.cwd(), `data/payslip.${customerId}/accdedref.json`), {});
          customerAccDeds[customerId] = accDed;
        };

        const accDedObj = accDed.getMutable(false);
        const paySlipObj = paySlip.getMutable(false);

        if (Object.keys(paySlipObj).length === 0) {
          withMenu(ctx,
            `Нет расчетного листка за период ${db.toLocaleDateString()} - ${de.toLocaleDateString()}!`,
            keyboardMenu);
        } else {

          let accrual = 0, salary = 0, tax = 0, ded = 0, saldo = 0, incomeTax = 0, pensionTax = 0, tradeUnionTax = 0, advance = 0, tax_ded = 0, privilage = 0;

          let strAccruals = '', strAdvances = '', strDeductions = '', strTaxes = '', strPrivilages = '', strTaxDeds = '';
          const lng = getLanguage(ctx.from?.language_code);

          for (const [key, value] of Object.entries(paySlipObj.data)) {
            if (new Date(value?.dateBegin) >= db && new Date(value?.dateEnd) <= de || new Date(value?.date) >= db && new Date(value?.date) <= de) {
              if (value.typeId === 'saldo') {
                saldo = saldo + value.s;
              } else if (value.typeId === 'salary') {
                salary = value.s;
              } else if (accDedObj[value.typeId]) {

                let accDedName = getLName(accDedObj[value.typeId].name, [lng, 'ru']) ;

                switch (accDedObj[value.typeId].type) {
                  case 'INCOME_TAX': {
                    incomeTax = incomeTax + value.s;
                    strTaxes = getPaySlipString(strTaxes, accDedName, value.s)
                    break;
                  }
                  case 'PENSION_TAX': {
                    pensionTax = pensionTax + value.s;
                    strTaxes = getPaySlipString(strTaxes, accDedName, value.s)
                    break;
                  }
                  case 'TRADE_UNION_TAX': {
                    tradeUnionTax = tradeUnionTax + value.s;
                    strTaxes = getPaySlipString(strTaxes, accDedName, value.s)
                    break;
                  }
                  case 'ADVANCE': {
                    advance = advance + value.s;
                    strAdvances = getPaySlipString(strAdvances, accDedName, value.s)
                    break;
                  }
                  case 'DEDUCTION': {
                    ded = ded + value.s;
                    strDeductions = getPaySlipString(strDeductions, accDedName, value.s)
                    break;
                  }
                  case 'TAX': {
                    tax = tax + value.s;
                    break;
                  }
                  case 'ACCRUAL': {
                    accrual = accrual + value.s;
                    strAccruals = getPaySlipString(strAccruals, accDedName, value.s)
                    break;
                  }
                  case 'TAX_DEDUCTION': {
                    tax_ded = tax_ded + value.s;
                    strTaxDeds = getPaySlipString(strTaxDeds, accDedName, value.s)
                    break;
                  }
                  case 'PRIVILAGE': {
                    privilage = privilage + value.s;
                    strPrivilages = getPaySlipString(strPrivilages, accDedName, value.s)
                    break;
                  }
                }
              }
            }
          };

          const allTaxes = incomeTax + pensionTax + tradeUnionTax;
          const len = 37;
          const lenS = 8;
          const cListok =
            `${'`'}${'`'}${'`'}ini
${'Начисления:'.padEnd(len)}  ${accrual.toFixed(2).padStart(lenS)}
=================================================
${strAccruals}
=================================================
${'Аванс:'.padEnd(len)}  ${advance.toFixed(2).padStart(lenS)}
=================================================
${strAdvances}
=================================================
${'Удержания:'.padEnd(len)}  ${ded.toFixed(2).padStart(lenS)}
=================================================
${strDeductions}
=================================================
${'Налоги:'.padEnd(len)}  ${allTaxes.toFixed(2).padStart(lenS)}
=================================================
${strTaxes}
=================================================
${'Вычеты:'.padEnd(len)}  ${tax_ded.toFixed(2).padStart(lenS)}
=================================================
${strTaxDeds}
=================================================
${'Льготы:'.padEnd(len)}  ${privilage.toFixed(2).padStart(lenS)}
=================================================
${strPrivilages}

${'`'}${'`'}${'`'}`;
            withMenu(ctx, cListok, keyboardMenu, true);
        }
      }
    }
  }
});

bot.action('delete', ({ deleteMessage }) => deleteMessage());

bot.launch();

/**
 * При завершении работы сервера скидываем на диск все данные.
 */
process.on('exit', code => {
  accountLink.flush();
  dialogStates.flush();
  customers.flush();

  for (const ec of Object.values(employeesByCustomer)) {
    ec.flush();
  }

  console.log('Process exit event with code: ', code);
});

process.on('SIGINT', () => process.exit() );

