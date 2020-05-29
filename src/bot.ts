import {
  DialogState, IAccountLink, IDialogStateLoggingIn, IAccDed, IPaySlip, Lang, TypePaySlip,
  ICustomers, IEmploeeByCustomer, IDialogStateGettingConcise, monthList, IDialogStateGettingCompare, IDialogStateGettingCurrency, addName, IDepartment, IPosition, LName, IPaySlipData, IPaySlipItem
} from "./types";
import { FileDB, IData } from "./util/fileDB";
import path from 'path';
import { normalizeStr, getLName, getSumByRate, date2str, replaceIdentLetters } from "./util/utils";
import { getCurrencyNameById, getCurrencyAbbreviationById, getCurrRate } from "./currency";

export const MINDATE = new Date(2018, 0, 1);

export interface IMenuButton {
  type: 'BUTTON';
  caption: string;
  command: string;
};

export interface IMenuLink {
  type: 'LINK';
  caption: string;
  url: string;
};

export type MenuItem = IMenuButton | IMenuLink;

export type Menu = MenuItem[][];

export type Template = [string, number?, boolean?][];

const keyboardLogin: Menu = [
  [
    { type: 'BUTTON', caption: '✏ Зарегистрироваться', command: 'login' },
    { type: 'LINK', caption: '❓', url: 'http://gsbelarus.com' }
  ]
];

export const keyboardMenu: Menu = [
  [
    { type: 'BUTTON', caption: '💰 Расчетный листок', command: 'paySlip' },
    { type: 'BUTTON', caption: '💰 Подробный листок', command: 'detailPaySlip' }
  ],
  [
    { type: 'BUTTON', caption: '💰 Листок за период', command: 'concisePaySlip' },
    { type: 'BUTTON', caption: '⚖ Сравнить', command: 'comparePaySlip' }
  ],
  [
    { type: 'BUTTON', caption: '🔧 Параметры', command: 'settings' },
    { type: 'BUTTON', caption: '🚪 Выйти', command: 'logout' }
  ],
  [
    { type: 'LINK', caption: '❓', url: 'http://gsbelarus.com' }
  ]
];

export const keyboardSettings: Menu = [
  [
    { type: 'BUTTON', caption: 'Выбрать валюту', command: 'getCurrency' },
    { type: 'BUTTON', caption: 'Меню', command: 'menu' }
   ]
];

export const keyboardCalendar = (lng: Lang, year: number): Menu => {
  const mm = [
    [0, 1, 2, 3],
    [4, 5, 6, 7],
    [8, 9, 10, 11]
  ];

  return mm.map(mr => mr.map(m => ({ type: 'BUTTON', caption: getLName(monthList[m], ['ru']), command: `month;${year};${m}` } as IMenuButton)))
    .concat([[
      { type: 'BUTTON', caption: ' < ', command: `prevYear;${year}` },
      { type: 'BUTTON', caption: `${year}`, command: `otherYear;${year}` },
      { type: 'BUTTON', caption: ' > ', command: `nextYear;${year}` }
    ]])
    .concat([[{ type: 'BUTTON', caption: 'Меню', command: 'menu' }]]);
};

export const keyboardCurrency = (lng: Lang): Menu => {
  const f = (currId: string) => ({ type: 'BUTTON', caption: getCurrencyNameById(lng, currId), command: `currency;${currId};${getCurrencyNameById(lng, currId)}` } as IMenuButton);

  return [
    [f('292'), f('145')],
    [f('298'), { type: 'BUTTON', caption: 'Белорусский рубль', command: `currency;0;Белорусский рубль` }],
    [{ type: 'BUTTON', caption: 'Меню', command: 'menu' }]
  ];
};

export const separateCallBackData = (data: string) => {
  return data.split(';');
}

export class Bot {
  private _accountLink: FileDB<IAccountLink>;
  private _dialogStates: FileDB<DialogState>;
  private getCustomers: () => ICustomers;
  private getEmployeesByCustomer: (customerId: string) => IEmploeeByCustomer;
  private getAccDeds: (customerId: string) => IData<IAccDed>;
  private getPaySlipByUser: (customerId: string, userId: string) => IPaySlip | undefined;

  constructor(dir: string,
    getCustomers: () => ICustomers,
    getEmployeesByCustomer: (customerId: string) => IEmploeeByCustomer,
    getAccDeds: (customerId: string) => IData<IAccDed>,
    getPaySlipByUser: (customerId: string, userId: string) => IPaySlip | undefined) {
    this._accountLink = new FileDB<IAccountLink>(path.resolve(process.cwd(), `data/${dir}/accountlink.json`), {});
    this._dialogStates = new FileDB<DialogState>(path.resolve(process.cwd(), `data/${dir}/dialogstates.json`), {});
    this.getCustomers = getCustomers;
    this.getEmployeesByCustomer = getEmployeesByCustomer;
    this.getPaySlipByUser = getPaySlipByUser;
    this.getAccDeds = getAccDeds;
  }

  get accountLink() {
    return this._accountLink;
  }

  get dialogStates() {
    return this._dialogStates;
  }

  /**
   * Посылает сообщение в чат пользователя.
   * @param chatId
   * @param message
   */
  async sendMessage(chatId: string, message: string, menu?: Menu, markdown?: boolean) {

  }

  editMessageReplyMarkup(chatId: string, menu: Menu) {

  }

  deleteMessage(chatId: string) {

  }

  /**
   * Рассылка уведомления всем пользователям, кто зарегистрирован
   * @param text - текст уведомления
   */
  sendMessageToEmployees(customerId: string, text: string) {
    const dlgObj = this._dialogStates.getMutable(true);
    Object.entries(this._accountLink.getMutable(true)).filter(([_, acc]) => acc.customerId === customerId).forEach(([chatId, acc]) => {
      const dlg = dlgObj[chatId];
      if (dlg && dlg.type !== 'INITIAL' && dlg.type !== 'LOGGING_IN') {
        this.sendMessage(chatId, text, keyboardMenu);
      }
    })
  }

  /**
   * Рассылка уведомления одному пользователю
   * @param text - текст уведомления
   */
  sendMessageToEmployee(customerId: string, employeeId: string, text: string) {
    const dlgObj = this._dialogStates.getMutable(true);
    const accountLink = Object.entries(this._accountLink.getMutable(true)).find(([_, acc]) => acc.customerId === customerId && acc.employeeId === employeeId);
    if (accountLink) {
      const chatId = accountLink[0];
      const dlg = dlgObj[chatId];
      if (dlg && dlg.type !== 'INITIAL' && dlg.type !== 'LOGGING_IN') {
        this.sendMessage(chatId, text, keyboardMenu);
      }
    }
  }

  /**
   * Рассылка уведомления одному пользователю
   * @param text - текст уведомления
   */
  showPaySlip(customerId: string, employeeId: string, text: string) {
    const dlgObj = this._dialogStates.getMutable(true);
    const today = new Date();
    const db = new Date(today.getFullYear(), today.getMonth(), 1);
    const de = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    Object.entries(this._accountLink.getMutable(true)).filter(([_, acc]) => acc.customerId === customerId && acc.employeeId === employeeId)
    .forEach(async(acclink) => {
      const chatId = acclink[0];
      const dlg = dlgObj[chatId];
      if (dlg && dlg.type !== 'INITIAL' && dlg.type !== 'LOGGING_IN') {
        await this.sendMessage(chatId, text);
        this.paySlip(chatId, 'CONCISE', 'ru', db, de);
      }
    })
  }


  /**
   * Диалог регистрации
   * @param chatId
   */
  async loginDialog(chatId: string, message?: string, start = false) {
    if (message === 'login') {
      return
    }

    if (start) {
      await this.sendMessage(chatId, 'Для регистрации в системе введите указанные данные.');
      this._dialogStates.merge(chatId, { type: 'LOGGING_IN', lastUpdated: new Date().getTime(), employee: {} });
    }

    const dialogState = this._dialogStates.getMutable(true)[chatId];

    if (!dialogState || dialogState.type !== 'LOGGING_IN') {
      throw new Error('Invalid dialog state');
    }

    const text = !message ? '' : normalizeStr(message);
    const { employee } = dialogState as IDialogStateLoggingIn;

    if (text) {
      if (!employee.customerId) {
        const found = Object.entries(this.getCustomers()).find(([_, c]) =>
          normalizeStr(c.name) === text || c.aliases.find(
            (a: any) => normalizeStr(a) === text
          )
        );

        if (found) {
          employee.customerId = found[0];
        } else {
          await this.sendMessage(chatId, '😕 Такой организации нет в базе данных!', keyboardLogin);
          this._dialogStates.merge(chatId, { type: 'INITIAL', lastUpdated: new Date().getTime() }, ['employee']);
          return;
        }
      }
      else if (!employee.lastName) {
        employee.lastName = text;
      }
      else if (!employee.firstName) {
        employee.firstName = text;
      }
      else if (!employee.patrName) {
        employee.patrName = text;
      }
      else if (!employee.passportId) {
        employee.passportId = replaceIdentLetters(text);
      }
    }

    if (employee.passportId && employee.customerId) {
      let employees = this.getEmployeesByCustomer(employee.customerId);

      const found = employees ? Object.entries(employees).find(
        ([_, e]) =>
          normalizeStr(e.lastName) === employee.lastName
          &&
          normalizeStr(e.firstName) === employee.firstName
          &&
          normalizeStr(e.patrName) === employee.patrName
          &&
         replaceIdentLetters(e.passportId) === employee.passportId
      )
        : undefined;

      if (found) {
        this._accountLink.merge(chatId, {
          customerId: employee.customerId,
          employeeId: found[0]
        });
        this._accountLink.flush();
        this._dialogStates.merge(chatId, { type: 'LOGGED_IN', lastUpdated: new Date().getTime() }, ['employee']);
        this.sendMessage(chatId, '🏁 Регистрация прошла успешно.', keyboardMenu);
      } else {
        this.sendMessage(chatId,
`Сотрудник не найден в базе данных.

Обратитесь в отдел кадров или повторите регистрацию.

Были введены следующие данные:
Организация: ${this.getCustomers()[employee.customerId].name}
Фамилия: ${employee.lastName}
Имя: ${employee.firstName}
Отчество: ${employee.patrName}
Идентификационный номер: ${employee.passportId}`,
        keyboardLogin);

        this._dialogStates.merge(chatId, { type: 'INITIAL', lastUpdated: new Date().getTime() }, ['employee']);
      }
    } else {
      if (!employee.customerId) {
        this.sendMessage(chatId, 'Введите название организации:');
      }
      else if (!employee.lastName) {
        this.sendMessage(chatId, 'Введите фамилию:');
      }
      else if (!employee.firstName) {
        this.sendMessage(chatId, 'Введите имя:');
      }
      else if (!employee.patrName) {
        this.sendMessage(chatId, 'Введите отчество:');
      }
      else if (!employee.passportId) {
        this.sendMessage(chatId, 'Введите идентификационный номер из паспорта:');
      }
    }
  }

  calendarSelection(chatId: string, queryData: string, lng: Lang): Date | undefined {
    const [action, year, month] = separateCallBackData(queryData);

    switch (action) {
      case 'month': {
        const selectedDate = new Date(parseInt(year), parseInt(month), 1);
        return selectedDate;
      }
      case 'prevYear': {
        this.editMessageReplyMarkup(chatId, keyboardCalendar(lng, parseInt(year) - 1));
        break;
      }
      case 'nextYear': {
        this.editMessageReplyMarkup(chatId, keyboardCalendar(lng, parseInt(year) + 1));
        break;
      }
      case 'otherYear': {
        break;
      }
    }
    return undefined;
  }

  currencySelection(chatId: string, queryData: string, lng: Lang): string | undefined {
    const [action, currencyId] = separateCallBackData(queryData);
    switch (action) {
      case 'currency': {
        return currencyId;
      }
    }
    return undefined;
  }

  async paySlipDialog(chatId: string, lng: Lang, queryData?: string, start = false) {
    if (start) {
      await this.sendMessage(chatId, 'Укажите начало периода:',
        keyboardCalendar(lng, new Date().getFullYear()), true);
      this._dialogStates.merge(chatId, { type: 'GETTING_CONCISE', lastUpdated: new Date().getTime(), db: undefined, de: undefined });
    }

    const dialogState = this._dialogStates.getMutable(true)[chatId];

    if (!dialogState || dialogState.type !== 'GETTING_CONCISE') {
      throw new Error('Invalid dialog state');
    }
    if (queryData) {
      const { db, de } = dialogState as IDialogStateGettingConcise;
      if (!db) {
        const db = this.calendarSelection(chatId, queryData, lng);
        if (db) {
          await this.sendMessage(chatId, date2str(db));
          this._dialogStates.merge(chatId, { type: 'GETTING_CONCISE', lastUpdated: new Date().getTime(), db });
          await this.sendMessage(chatId, 'Укажите окончание периода:', keyboardCalendar(lng, new Date().getFullYear()), true);
        }
      } else if (!de) {
        let de = this.calendarSelection(chatId, queryData, lng);
        if (de) {
          de = new Date(de.getFullYear(), de.getMonth() + 1, 0)
          await this.sendMessage(chatId, date2str(de));
          this._dialogStates.merge(chatId, { type: 'GETTING_CONCISE', lastUpdated: new Date().getTime(), de });
          const cListok = await this.getPaySlip(chatId, 'CONCISE', lng, db, de);
          if (cListok !== '') {
            await this.sendMessage(chatId, cListok, keyboardMenu, true);
          } else {
            await this.sendMessage(chatId,
              `Нет данных для расчетного листка 🤔`,
              keyboardMenu);
          }
        }
      }
    }
  }

  async paySlipCompareDialog(chatId: string, lng: Lang, queryData?: string, start = false) {
    if (start) {
      await this.sendMessage(chatId, 'Укажите начало первого периода:', keyboardCalendar(lng, new Date().getFullYear()), true);
      this._dialogStates.merge(chatId, { type: 'GETTING_COMPARE', lastUpdated: new Date().getTime(), fromDb: undefined, fromDe: undefined, toDb: undefined, toDe: undefined });
    }

    const dialogState = this._dialogStates.getMutable(true)[chatId];

    if (!dialogState || dialogState.type !== 'GETTING_COMPARE') {
      throw new Error('Invalid dialog state');
    }

    if (queryData) {
      const { fromDb, fromDe, toDb, toDe } = dialogState as IDialogStateGettingCompare;
      if (!fromDb) {
        const db = this.calendarSelection(chatId, queryData, lng);
        if (db) {
          await this.sendMessage(chatId, date2str(db));
          this._dialogStates.merge(chatId, { type: 'GETTING_COMPARE', lastUpdated: new Date().getTime(), fromDb: db });
          await this.sendMessage(chatId, 'Укажите окончание первого периода:', keyboardCalendar(lng, new Date().getFullYear()), true);
        }
      } else if (!fromDe) {
        let de = this.calendarSelection(chatId, queryData, lng);
        if (de) {
          de = new Date(de.getFullYear(), de.getMonth() + 1, 0);
          await this.sendMessage(chatId, date2str(de));
          this._dialogStates.merge(chatId, { type: 'GETTING_COMPARE', lastUpdated: new Date().getTime(), fromDe: de });
          await this.sendMessage(chatId, 'Укажите начало второго периода:', keyboardCalendar(lng, new Date().getFullYear()), true);
        }
      } else if (!toDb) {
        let db = this.calendarSelection(chatId, queryData, lng);
        if (db) {
          await this.sendMessage(chatId, date2str(db));
          this._dialogStates.merge(chatId, { type: 'GETTING_COMPARE', lastUpdated: new Date().getTime(), toDb: db });
          await this.sendMessage(chatId, 'Укажите окончание второго периода:', keyboardCalendar(lng, new Date().getFullYear()), true);
        }
      } else if (!toDe) {
        let de = this.calendarSelection(chatId, queryData, lng);
        if (de) {
          de = new Date(de.getFullYear(), de.getMonth() + 1, 0);
          await this.sendMessage(chatId, date2str(de));
          this._dialogStates.merge(chatId, { type: 'GETTING_COMPARE', lastUpdated: new Date().getTime(), toDe: de });
          const cListok = await this.getPaySlip(chatId, 'COMPARE', lng, fromDb, fromDe, toDb, de);
          if (cListok !== '') {
            await this.sendMessage(chatId, cListok, keyboardMenu, true);
          } else {
            await this.sendMessage(chatId,
              `Нет данных для расчетного листка 🤔`,
              keyboardMenu);
          }
        }
      }
    }
  }

  /**
   * Диалог для выбора валюты
   * @param chatId - ИД чата
   * @param lng - язык бота
   * @param queryData - значение валюты, которое выбрал пользователь
   * @param start - true при нажатии на кнопку Выбрать валюту
   */
  async currencyDialog(chatId: string, lng: Lang, queryData?: string, start = false) {
    if (start) {
      this.deleteMessage(chatId);
      this._dialogStates.merge(chatId, { type: 'GETTING_CURRENCY', lastUpdated: new Date().getTime() });
      await this.sendMessage(chatId, 'Выберите валюту:', keyboardCurrency(lng));
      return;
    }

    const dialogState = this._dialogStates.getMutable(true)[chatId];

    if (!dialogState || dialogState.type !== 'GETTING_CURRENCY') {
      throw new Error('Invalid dialog state');
    }

    const { currencyId } = dialogState as IDialogStateGettingCurrency;

    if (!currencyId && queryData) {
      const currencyId = this.currencySelection(chatId, queryData, lng);
      if (currencyId !== undefined) {
        const link = this._accountLink.read(chatId);
        this._accountLink.merge(chatId, { ...link, currencyId });
        const currencyName = getCurrencyNameById(lng, currencyId);
        this.deleteMessage(chatId);
        this.sendMessage(chatId, `Валюта ${currencyName} сохранена. Выберите одно из предложенных действий.`, keyboardMenu);
        this._accountLink.flush();
      }
    }
  }

  paySlipView(template: Template): string {
    return ''
  }

  /**
  * Разделяем длинную строку на несколько
   * @param prevStr
   * @param name
   * @param s
   */
  getPaySlipString(prevStr: string, name: string, s?: number) {
    return ''
  }

  getPaySlipData(paySlip: IPaySlip, customerId: string, db: Date, de: Date): IPaySlipData {
    const accDedObj = this.getAccDeds(customerId);

    const data: IPaySlipData = {
      department: {},
      position: {}
    };

    // Подразделение получаем из массива подразделений dept,
    // как первый элемент с максимальной датой, но меньший даты окончания расч. листка
    // Аналогично с должностью из массива pos
    let maxDate: Date = paySlip.dept[0].d;
    paySlip.dept.forEach( deptItem => {
      if (maxDate.getMilliseconds() < deptItem.d.getMilliseconds() && deptItem.d.getMilliseconds() <= de.getMilliseconds()) {
        maxDate = deptItem.d;
        data.department = deptItem.name;
      }
    })

    maxDate = paySlip.pos[0].d;
    paySlip.pos.forEach( posItem => {
      if (maxDate.getMilliseconds() < posItem.d.getMilliseconds() && posItem.d.getMilliseconds() <= de.getMilliseconds()) {
        maxDate = posItem.d;
        data.position = posItem.name;
      }
    })

    maxDate = paySlip.salary[0].d;
    paySlip.salary.forEach( salaryItem => {
      if (maxDate.getMilliseconds() < salaryItem.d.getMilliseconds() && salaryItem.d.getMilliseconds() <= de.getMilliseconds()) {
        maxDate = salaryItem.d;
        data.salary = salaryItem.s;
      }
    })

    if (paySlip.hourrate) {
      maxDate = paySlip.hourrate[0].d;
      paySlip.hourrate?.forEach( hourRateItem => {
        if (maxDate.getMilliseconds() < hourRateItem.d.getMilliseconds() && hourRateItem.d.getMilliseconds() <= de.getMilliseconds()) {
          maxDate = hourRateItem.d;
          data.hourrate = hourRateItem.s;
        }
      })
    }

    //Цикл по всем записям начислений-удержаний
    for (const value of Object.values(paySlip.data)) {
      if (new Date(value?.db) >= db && new Date(value?.de) <= db) {

        const name = accDedObj[value.typeId].name;
        const det = value.det;

        switch (accDedObj[value.typeId].type) {
          case 'SALDO':
            data.saldo = {
              name,
              s: value.s
            }
          case 'INCOME_TAX':
          case 'PENSION_TAX':
          case 'TRADE_UNION_TAX': {
            data.tax?.push({
              name,
              s: value.s,
              type: accDedObj[value.typeId].type,
              det
            })
            break;
          }
          case 'ADVANCE': {
            data.advance?.push({
              name,
              s: value.s,
              det
            })
            break;
          }
          case 'DEDUCTION': {
            data.deduction?.push({
              name,
              s: value.s,
              det
            })
            break;
          }
          case 'ACCRUAL': {
            data.accrual?.push({
              name,
              s: value.s,
              det
            })
            break;
          }
          case 'TAX_DEDUCTION': {
            data.tax_deduction?.push({
              name,
              s: value.s,
              det
            })
            break;
          }
          case 'PRIVILAGE': {
            data.privilage?.push({
              name,
              s: value.s,
              det
            })
            break;
          }
        }
      }
    };
    return data
  }

  async getPaySlipByRate(data: IPaySlipData, currencyId: string, date: Date): Promise<IPaySlipData> {
    const rate = currencyId && currencyId !== '0' ? await getCurrRate(date, currencyId) : undefined;
    if (rate) {
      const newData = {
        department: data.department,
        position: data.position,
        saldo: data.saldo ? {...data.saldo, s: getSumByRate(data.saldo.s, rate)} : undefined,
        tax: data.tax ? data.tax.map(i => ({...i, s: getSumByRate(i.s, rate)})) : undefined,
        advance: data.advance ? data.advance.map(i => ({...i, s: getSumByRate(i.s, rate)})) : undefined,
        deduction: data.deduction ? data.deduction.map(i => ({...i, s: getSumByRate(i.s, rate)})) : undefined,
        accrual: data.accrual ? data.accrual.map(i => ({...i, s: getSumByRate(i.s, rate)})) : undefined,
        tax_deduction: data.tax_deduction ? data.tax_deduction.map(i => ({...i, s: getSumByRate(i.s, rate)})) : undefined,
        privilage: data.privilage ? data.privilage.map(i => ({...i, s: getSumByRate(i.s, rate)})) : undefined,
        salary: data.salary ? getSumByRate(data.salary, rate) : undefined,
        hourrate: data.hourrate,
        rate
      }
      return newData;
    }
    return data;
  }

  getShortPaySlip(data: IPaySlipData, customerId: string, employeeId: string, db: Date, de: Date, lng: Lang, currencyId?: string): Template {
    const empls = this.getEmployeesByCustomer(customerId);
    const emplName = `${empls[employeeId].lastName} ${empls[employeeId].firstName.slice(0, 1)}. ${empls[employeeId].patrName.slice(0, 1)}.`;
    const period = de.getFullYear() !== db.getFullYear() || de.getMonth() !== db.getMonth()
      ? `${date2str(db)}-${date2str(de)}`
      : `${db.toLocaleDateString(lng, { month: 'long', year: 'numeric' })}`;
    const currencyAbbreviation = getCurrencyAbbreviationById(currencyId);

    const accruals = data.accrual?.reduce((prev, cur) => prev + cur.s, 0) || 0;
    const taxes = data.tax?.reduce((prev, cur) => prev + cur.s, 0) || 0;
    const deds = data.deduction?.reduce((prev, cur) => prev + cur.s, 0);
    const advances = data.advance?.reduce((prev, cur) => prev + cur.s, 0);
    const incomeTax = data.tax?.reduce((prev, cur) => prev + (cur.type === 'INCOME_TAX' ? cur.s : 0), 0);
    const pensionTax = data.tax?.reduce((prev, cur) => prev + (cur.type === 'PENSION_TAX' ? cur.s : 0), 0);
    const tradeUnionTax = data.tax?.reduce((prev, cur) => prev + (cur.type === 'TRADE_UNION_TAX' ? cur.s : 0), 0);

    return  [
              ['Расчетный листок'],
              [emplName],
              [`Период: ${period}`],
              [`Валюта: ${currencyAbbreviation}`],
              [`Курс на ${date2str(db)}:`, data.rate],
              ['='],
              ['Начислено:', accruals, true],
              ['='],
              ['Зарплата чистыми:', accruals - taxes],
              ['  Удержания:', deds, true],
              ['  Аванс:', advances, true],
              ['  К выдаче:', data.saldo?.s, true],
              ['='],
              ['Налоги:', taxes],
              ['  Подоходный:', incomeTax, true],
              ['  Пенсионный:', pensionTax, true],
              ['  Профсоюзный:', tradeUnionTax, true],
              ['='],
              [`Информация на ${date2str(de)}:`],
              ['Подразделение:'],
              [this.getPaySlipString('', getLName(data.department, [lng, 'ru']))],
              ['Должность:'],
              [this.getPaySlipString('', getLName(data.position, [lng, 'ru']))],
              ['Оклад:', data.salary, true],
              ['ЧТС:', data.hourrate, true]
            ];
  }

  getDetailPaySlip(data: IPaySlipData, customerId: string, employeeId: string, db: Date, de: Date, lng: Lang, currencyId?: string): Template {
    const empls = this.getEmployeesByCustomer(customerId);
    const emplName = `${empls[employeeId].lastName} ${empls[employeeId].firstName.slice(0, 1)}. ${empls[employeeId].patrName.slice(0, 1)}.`;
    const period = de.getFullYear() !== db.getFullYear() || de.getMonth() !== db.getMonth()
      ? `${date2str(db)}-${date2str(de)}`
      : `${db.toLocaleDateString(lng, { month: 'long', year: 'numeric' })}`;
    const currencyAbbreviation = getCurrencyAbbreviationById(currencyId);

    const accruals = data.accrual?.reduce((prev, cur) => prev + cur.s, 0);
    const taxes = data.tax?.reduce((prev, cur) => prev + cur.s, 0);
    const deds = data.deduction?.reduce((prev, cur) => prev + cur.s, 0);
    const taxDeds = data.tax_deduction?.reduce((prev, cur) => prev + cur.s, 0);
    const advances = data.advance?.reduce((prev, cur) => prev + cur.s, 0);
    const privilages = data.privilage?.reduce((prev, cur) => prev + cur.s, 0);

    const strAccruals = data.accrual?.reduce((prev, cur) => this.getPaySlipString(prev, getLName(cur.name, [lng, 'ru']), cur.s), '') || ''
    const strDeductions = data.deduction?.reduce((prev, cur) => this.getPaySlipString(prev, getLName(cur.name, [lng, 'ru']), cur.s), '') || ''
    const strAdvances = data.advance?.reduce((prev, cur) => this.getPaySlipString(prev, getLName(cur.name, [lng, 'ru']), cur.s), '') || ''
    const strTaxes = data.tax?.reduce((prev, cur) => this.getPaySlipString(prev, getLName(cur.name, [lng, 'ru']), cur.s), '') || ''
    const strTaxDeds = data.tax_deduction?.reduce((prev, cur) => this.getPaySlipString(prev, getLName(cur.name, [lng, 'ru']), cur.s), '') || ''
    const strPrivilages = data.privilage?.reduce((prev, cur) => this.getPaySlipString(prev, getLName(cur.name, [lng, 'ru']), cur.s), '') || ''

    return  [
              ['Расчетный листок'],
              [emplName],
              [`Период: ${period}`],
              [`Валюта: ${currencyAbbreviation}`],
              [`Курс на ${date2str(db)}:`, data.rate],
              ['='],
              ['Начисления:', accruals, true],
              [accruals ? '=' : ''],
              [strAccruals],
              [accruals ? '=' : ''],
              ['Удержания:', deds, true],
              [deds ? '=' : ''],
              [strDeductions],
              [deds ? '=' : ''],
              ['Аванс:', advances, true],
              [advances ? '=' : ''],
              [strAdvances],
              [advances ? '=' : ''],
              ['Налоги:', taxes, true],
              [taxes ? '=' : ''],
              [strTaxes],
              [taxes ? '=' : ''],
              ['Вычеты:', taxDeds, true],
              [taxDeds ? '=' : ''],
              [strTaxDeds],
              [taxDeds ? '=' : ''],
              ['Льготы:', privilages, true],
              [privilages ? '=' : ''],
              [strPrivilages],
              [privilages ? '=' : ''],
              [`Информация на ${date2str(de)}:`],
              ['Подразделение:'],
              [this.getPaySlipString('', getLName(data.department, [lng, 'ru']))],
              ['Должность:'],
              [this.getPaySlipString('', getLName(data.position, [lng, 'ru']))],
              ['Оклад:', data.salary, true],
              ['ЧТС:', data.hourrate, true]
            ];
  }

  getComparePaySlip(dataI: IPaySlipData, dataII: IPaySlipData, customerId: string, employeeId: string, dbI: Date, deI: Date, dbII: Date, deII: Date, lng: Lang, currencyId?: string):Template {
    const empls = this.getEmployeesByCustomer(customerId);
    const emplName = `${empls[employeeId].lastName} ${empls[employeeId].firstName.slice(0, 1)}. ${empls[employeeId].patrName.slice(0, 1)}.`;
    const currencyAbbreviation = getCurrencyAbbreviationById(currencyId);

    const accrualsI = dataI.accrual?.reduce((prev, cur) => prev + cur.s, 0) || 0;
    const taxesI = dataI.tax?.reduce((prev, cur) => prev + cur.s, 0) || 0;
    const dedsI = dataI.deduction?.reduce((prev, cur) => prev + cur.s, 0) || 0;
    const advancesI = dataI.advance?.reduce((prev, cur) => prev + cur.s, 0) || 0;

    const incomeTaxI = dataI.tax?.reduce((prev, cur) => prev + (cur.type === 'INCOME_TAX' ? cur.s : 0), 0) || 0;
    const pensionTaxI = dataI.tax?.reduce((prev, cur) => prev + (cur.type === 'PENSION_TAX' ? cur.s : 0), 0) || 0;
    const tradeUnionTaxI = dataI.tax?.reduce((prev, cur) => prev + (cur.type === 'TRADE_UNION_TAX' ? cur.s : 0), 0) || 0;

    const accrualsII = dataII.accrual?.reduce((prev, cur) => prev + cur.s, 0) || 0;
    const taxesII = dataII.tax?.reduce((prev, cur) => prev + cur.s, 0) || 0;
    const dedsII = dataII.deduction?.reduce((prev, cur) => prev + cur.s, 0) || 0;
    const advancesII = dataII.advance?.reduce((prev, cur) => prev + cur.s, 0) || 0;

    const incomeTaxII = dataII.tax?.reduce((prev, cur) => prev + (cur.type === 'INCOME_TAX' ? cur.s : 0), 0) || 0;
    const pensionTaxII = dataII.tax?.reduce((prev, cur) => prev + (cur.type === 'PENSION_TAX' ? cur.s : 0), 0) || 0;
    const tradeUnionTaxII = dataII.tax?.reduce((prev, cur) => prev + (cur.type === 'TRADE_UNION_TAX' ? cur.s : 0), 0) || 0;


    return  [
              ['Сравнение расчетных листков'],
              [emplName],
              [`Валюта: ${currencyAbbreviation}`],
              [` I: ${date2str(dbI)}-${date2str(deI)}`],
              [`II: ${date2str(dbII)}-${date2str(deII)}`],
              [`Курс на ${date2str(dbI)}:`, dataI.rate],
              [`Курс на ${date2str(dbII)}:`, dataII.rate],
              ['='],
              ['Начислено  I:', accrualsI, true],
              ['Начислено II:', accrualsII, true],
              ['Разница:', accrualsII - accrualsI],
              ['='],
              ['Чистыми  I:', accrualsI - taxesI],
              ['Чистыми II:', accrualsII - taxesII],
              ['Разница:', accrualsII - taxesII - (accrualsI - taxesI)],
              ['  К выдаче  I:', dataI.saldo?.s, true],
              ['  К выдаче II:', dataII.saldo?.s, true],
              ['  Разница:', dataII.saldo?.s || 0 - (dataI.saldo?.s || 0)],
              [(accrualsII - taxesII) || (accrualsI - taxesI) ? '=' : ''],
              ['  Удержания  I:', dedsI, true],
              ['  Удержания II:', dedsII, true],
              ['  Разница:', dedsII - dedsI],
              ['  Аванс  I:', advancesI, true],
              ['  Аванс II:', advancesII, true],
              ['  Разница:', advancesII - advancesI],
              [dedsI || dedsII ? '=' : ''],
              ['Налоги  I:', taxesI, true],
              ['Налоги II:', taxesII, true],
              ['Разница:', taxesII - taxesI],
              ['  Подоходный  I:', incomeTaxI, true],
              ['  Подоходный II:', incomeTaxII, true],
              ['  Разница:', incomeTaxII - incomeTaxI],
              ['  Пенсионный  I:', pensionTaxI, true],
              ['  Пенсионный II:', pensionTaxI, true],
              ['  Разница:', pensionTaxII - pensionTaxI],
              ['  Профсоюзный  I:', tradeUnionTaxI, true],
              ['  Профсоюзный II:', tradeUnionTaxII, true],
              ['  Разница:', tradeUnionTaxII - tradeUnionTaxI],
              [taxesI || taxesII ? '=' : ''],
              [`Информация на ${date2str(deI)}:`],
              ['Подразделение:'],
              [this.getPaySlipString('', getLName(dataI.department, [lng, 'ru']))],
              ['Должность:'],
               [this.getPaySlipString('', getLName(dataI.position, [lng, 'ru']))],
              ['='],
              [`Информация на ${date2str(deII)}:`],
              ['Подразделение:'],
              [this.getPaySlipString('', getLName(dataII.department, [lng, 'ru']))],
              ['Должность:'],
              [this.getPaySlipString('', getLName(dataII.position, [lng, 'ru']))],
              ['='],
              [`Оклад на ${date2str(deI)}:`, dataI.salary, true],
              [`Оклад на ${date2str(deII)}:`, dataII.salary, true],
              ['Разница:', dataII.salary || 0 - (dataII.salary || 0)],
              [`ЧТС на ${date2str(deI)}:`, dataI.hourrate, true],
              [`ЧТС на ${date2str(deII)}:`, dataII.hourrate, true],
              ['Разница:', dataII.hourrate || 0 - (dataI.hourrate || 0)]
            ];
  }


  async getPaySlip(chatId: string, typePaySlip: TypePaySlip, lng: Lang, db: Date, de: Date, dbII?: Date, deII?: Date): Promise<string> {
    const link = this._accountLink.read(chatId);

    if (link?.customerId && link.employeeId) {
      const { customerId, employeeId, currencyId } = link;

      let paySlip = this.getPaySlipByUser(customerId, employeeId);

      if (!paySlip) {
          //continue;
      } else {
        let dataI = this.getPaySlipData(paySlip, customerId, db, de);
        if (dataI)
        if (currencyId) {
          dataI = await this.getPaySlipByRate(dataI, currencyId, db);
        }
        if (!dataI.rate) {
          return ('Курс валюты не был загружен')
        }

        let template: Template = [];

        switch (typePaySlip) {
          case 'DETAIL': {
            template = this.getDetailPaySlip(dataI, customerId, employeeId, db, de, lng, currencyId);
          }
          case 'CONCISE': {
            template = this.getShortPaySlip(dataI, customerId, employeeId, db, de, lng, currencyId);
          }
          case 'COMPARE': {
            if (dbII && deII) {
              let dataII = this.getPaySlipData(paySlip, customerId, dbII, deII);
              if (currencyId) {
                dataII = await this.getPaySlipByRate(dataII, currencyId, dbII);
              }
              template = this.getComparePaySlip(dataI, dataII, customerId, employeeId, db, de, dbII, deII, lng, currencyId);
            }
          }
        }
        return this.paySlipView(template);
      }
    }
    return '';
  }


  async getPaySlip1(chatId: string, typePaySlip: TypePaySlip, lng: Lang, db: Date, de: Date, toDb?: Date, toDe?: Date): Promise<string> {
    const link = this._accountLink.read(chatId);

    if (link?.customerId && link.employeeId) {
      const { customerId, employeeId, currencyId } = link;
      const rate = currencyId && currencyId !== '0' ? await getCurrRate(db, currencyId) : 1;
      const currencyAbbreviation = currencyId && currencyId !== '0' ? getCurrencyAbbreviationById(currencyId) : 'BYN';

      if (!rate) {
        return ('Курс валюты не был загружен')
      }

      const empls = this.getEmployeesByCustomer(customerId);
      const accDedObj = this.getAccDeds(customerId);

      let allTaxes = [0, 0];

      const accrual = [0, 0], salary = [0, 0], hourrate =[0, 0], tax = [0, 0], ded = [0, 0], saldo = [0, 0],
        incomeTax = [0, 0], pensionTax = [0, 0], tradeUnionTax = [0, 0], advance = [0, 0], tax_ded = [0, 0], privilage = [0, 0];

      // const data = {
      //   accrual: {
      //     caption: '',
      //     values: [0, 0],
      //     needDblLine: true
      //   }
      // };

      let strAccruals = '', strAdvances = '', strDeductions = '', strTaxes = '', strPrivilages = '', strTaxDeds = '';

      let deptName = ['', ''];
      let posName = ['', ''];
      const dbMonthName = db.toLocaleDateString(lng, { month: 'long', year: 'numeric' });
      let isHavingData = false;

      /** */

      /**
       * Получаем информацию по расчетным листкам за период
       * @param fromDb - дата начала периода
       * @param fromDe - дата окончания периода
       * @param i
       */
      const getAccDedsByPeriod = (fromDb: Date, fromDe: Date, i: number) => {
        let paySlip = this.getPaySlipByUser(customerId, employeeId);

        if (!paySlip) {
          //continue;
        } else {
          //Подразделение получаем из массива подразделений dept,
          //как первый элемент с максимальной датой, но меньший даты начала расч. листка
          //Аналогично с должностью из массива pos
          const dept = paySlip.dept
            .filter(deptItem => new Date(deptItem.d) <= fromDe)
            .sort((a, b) => new Date(b.d).getTime() - new Date(a.d).getTime());

          deptName[i] = dept[0] && getLName(dept[0].name, [lng, 'ru']);

          const pos = paySlip.pos
            .filter(posItem => new Date(posItem.d) <= fromDe)
            .sort((a, b) => new Date(b.d).getTime() - new Date(a.d).getTime());

          posName[i] = pos[0] && getLName(pos[0].name, [lng, 'ru']);

          const sal = paySlip.salary
            .filter(posItem => new Date(posItem.d) <= fromDe)
            .sort((a, b) => new Date(b.d).getTime() - new Date(a.d).getTime());
          if (sal?.length) {
            salary[i] = sal[0]?.s
          }

          const hr = paySlip.hourrate
            ?.filter(posItem => new Date(posItem.d) <= fromDe)
            .sort((a, b) => new Date(b.d).getTime() - new Date(a.d).getTime());
          if (hr?.length) {
            hourrate[i] = hr[0]?.s;
          }

          //Цикл по всем записям начислений-удержаний
          for (const [key, value] of Object.entries(paySlip.data)) {
            if (new Date(value?.db) >= fromDb && new Date(value?.de) <= fromDe) {
              isHavingData = true;

              if (value.typeId === 'saldo') {
                saldo[i] = saldo[i] + value.s;
              } else if (accDedObj[value.typeId]) {

                let accDedName = getLName(accDedObj[value.typeId].name, [lng, 'ru']);
                let det = '';

                det = value?.det?.days ? `${value.det.days}${getLName(addName['days'], [lng, 'ru'])}` : ''
                if (value?.det?.hours) {
                  det = `${det}${det ?  ', ' : ''}`;
                  det = `${value.det.hours}${getLName(addName['hours'], [lng, 'ru'])}`;
                }
                if (value?.det?.incMonth || value?.det?.incYear) {
                  det = `${det}${det ?  ', ' : ''}`;
                  det = `${value.det.incMonth}.${value.det.incYear}`;
                }
                if (det) {
                  accDedName = `${accDedName} (${det})`
                }

                switch (accDedObj[value.typeId].type) {
                  case 'INCOME_TAX': {
                    incomeTax[i] = incomeTax[i] + value.s;
                    strTaxes = typePaySlip === 'DETAIL' ? this.getPaySlipString(strTaxes, accDedName, getSumByRate(value.s, rate)) : ''
                    break;
                  }
                  case 'PENSION_TAX': {
                    pensionTax[i] = pensionTax[i] + value.s;
                    strTaxes = typePaySlip === 'DETAIL' ? this.getPaySlipString(strTaxes, accDedName, getSumByRate(value.s, rate)) : ''
                    break;
                  }
                  case 'TRADE_UNION_TAX': {
                    tradeUnionTax[i] = tradeUnionTax[i] + value.s;
                    strTaxes = typePaySlip === 'DETAIL' ? this.getPaySlipString(strTaxes, accDedName, getSumByRate(value.s, rate)) : ''
                    break;
                  }
                  case 'ADVANCE': {
                    advance[i] = advance[i] + value.s;
                    strAdvances = typePaySlip === 'DETAIL' ? this.getPaySlipString(strAdvances, accDedName, getSumByRate(value.s, rate)) : ''
                    break;
                  }
                  case 'DEDUCTION': {
                    ded[i] = ded[i] + value.s;
                    strDeductions = typePaySlip === 'DETAIL' ? this.getPaySlipString(strDeductions, accDedName, getSumByRate(value.s, rate)) : ''
                    break;
                  }
                  case 'TAX': {
                    tax[i] = tax[i] + value.s;
                    break;
                  }
                  case 'ACCRUAL': {
                    accrual[i] = accrual[i] + value.s;
                    strAccruals = typePaySlip === 'DETAIL' ? this.getPaySlipString(strAccruals, accDedName, getSumByRate(value.s, rate)) : ''
                    break;
                  }
                  case 'TAX_DEDUCTION': {
                    tax_ded[i] = tax_ded[i] + value.s;
                    strTaxDeds = typePaySlip === 'DETAIL' ? this.getPaySlipString(strTaxDeds, accDedName, getSumByRate(value.s, rate)) : ''
                    break;
                  }
                  case 'PRIVILAGE': {
                    privilage[i] = privilage[i] + value.s;
                    strPrivilages = typePaySlip === 'DETAIL' ? this.getPaySlipString(strPrivilages, accDedName, getSumByRate(value.s, rate)) : ''
                    break;
                  }
                }
              }
            }
          };

          allTaxes[i] = getSumByRate(incomeTax[i], rate) + getSumByRate(pensionTax[i], rate) + getSumByRate(tradeUnionTax[i], rate);
        }
      };

      //Данные по листку заносятся в массивы с индектом = 0
      getAccDedsByPeriod(db, de, 0);

      if (isHavingData || typePaySlip === 'COMPARE') {
        let template: Template = [];
        const emplName = `${empls[employeeId].lastName} ${empls[employeeId].firstName.slice(0, 1)}. ${empls[employeeId].patrName.slice(0, 1)}.`;

        switch (typePaySlip) {
          case 'DETAIL': {
          /**
            * Массив массивов следущего типа:
            * Один элемент -- просто строка.
            * Два элемента: строка и число. Название параметра и его значение.
            * Три элемента: строка, число, true. Название параметра и значение. Будет пересчитано по курсу.
            */
            template = [
              ['Расчетный листок'],
              [emplName],
              [`Период: ${dbMonthName}`],
              [`Валюта: ${currencyAbbreviation}`],
              ['='],
              ['Начисления:', accrual[0], true],
              [accrual[0] ? '=' : ''],
              [strAccruals],
              [accrual[0] ? '=' : ''],
              ['Удержания:', ded[0], true],
              [ded[0] ? '=' : ''],
              [strDeductions],
              [ded[0] ? '=' : ''],
              ['Аванс:', advance[0], true],
              [advance[0] ? '=' : ''],
              [strAdvances],
              [advance[0] ? '=' : ''],
              ['Налоги:', allTaxes[0], true],
              [allTaxes[0] ? '=' : ''],
              [strTaxes],
              [allTaxes[0] ? '=' : ''],
              ['Вычеты:', tax_ded[0], true],
              [tax_ded[0] ? '=' : ''],
              [strTaxDeds],
              [tax_ded[0] ? '=' : ''],
              ['Льготы:', privilage[0], true],
              [privilage[0] ? '=' : ''],
              [strPrivilages],
              [privilage[0] ? '=' : ''],
              [`Информация на ${date2str(de)}:`],
              ['Подразделение:'],
              [this.getPaySlipString('', deptName[0])],
              ['Должность:'],
              [this.getPaySlipString('', posName[0])],
              ['Оклад:', salary[0], true],
              ['ЧТС:', hourrate[0], true]
            ];
            break;
          }
          case 'CONCISE': {
            const m = de.getFullYear() !== db.getFullYear() || de.getMonth() !== db.getMonth() ? `${date2str(db)}-${date2str(de)}` : `${dbMonthName}`;
            template = [
              ['Расчетный листок'],
              [emplName],
              [`Период: ${m}`],
              [`Валюта: ${currencyAbbreviation}`],
              ['='],
              ['Начислено:', accrual[0], true],
              ['='],
              ['Зарплата чистыми:', getSumByRate(accrual[0], rate) - allTaxes[0]],
              ['  Удержания:', ded[0], true],
              ['  Аванс:', advance[0], true],
              ['  К выдаче:', saldo[0], true],
              ['='],
              ['Налоги:', allTaxes[0]],
              ['  Подоходный:', incomeTax[0], true],
              ['  Пенсионный:', pensionTax[0], true],
              ['  Профсоюзный:', tradeUnionTax[0], true],
              ['='],
              [`Информация на ${date2str(de)}:`],
              ['Подразделение:'],
              [this.getPaySlipString('', deptName[0])],
              ['Должность:'],
              [this.getPaySlipString('', posName[0])],
              ['Оклад:', salary[0], true],
              ['ЧТС:', hourrate[0], true]
            ];
            break;
          }
          case 'COMPARE': {
            if (toDb && toDe) {
              //Данные по листку за второй период заносятся в массивы с индектом = 1
              getAccDedsByPeriod(toDb, toDe, 1);
              if (!isHavingData) {
                return ''
              };
              template = [
                ['Сравнение расчетных листков'],
                [emplName],
                [`Валюта: ${currencyAbbreviation}`],
                [` I: ${date2str(db)}-${date2str(de)}`],
                [`II: ${date2str(toDb)}-${date2str(toDe)}`],
                ['='],
                ['Начислено  I:', accrual[0], true],
                ['Начислено II:', accrual[1], true],
                ['Разница:', (getSumByRate(accrual[1], rate) - getSumByRate(accrual[0], rate))],
                ['='],
                ['Чистыми  I:', getSumByRate(accrual[0], rate) - allTaxes[0]],
                ['Чистыми II:', getSumByRate(accrual[1], rate) - allTaxes[1]],
                ['Разница:', getSumByRate(accrual[1], rate) - allTaxes[1] - (getSumByRate(accrual[0], rate) - allTaxes[0])],
                ['  К выдаче  I:', saldo[0], true],
                ['  К выдаче II:', saldo[1], true],
                ['  Разница:', getSumByRate(saldo[1], rate) - getSumByRate(saldo[0], rate)],
                [(getSumByRate(accrual[0], rate) - allTaxes[0]) || (getSumByRate(accrual[1], rate) - allTaxes[1]) ? '=' : ''],
                ['  Удержания  I:', ded[0], true],
                ['  Удержания II:', ded[1], true],
                ['  Разница:', getSumByRate(ded[1], rate) - getSumByRate(ded[0], rate)],
                ['  Аванс  I:', advance[0], true],
                ['  Аванс II:', advance[1], true],
                ['  Разница:', getSumByRate(advance[1], rate) - getSumByRate(advance[0], rate)],
                [ded[0] || ded[1] ? '=' : ''],
                ['Налоги  I:', allTaxes[0], true],
                ['Налоги II:', allTaxes[1], true],
                ['Разница:', allTaxes[1] - allTaxes[0]],
                ['  Подоходный  I:', incomeTax[0], true],
                ['  Подоходный II:', incomeTax[1], true],
                ['  Разница:', getSumByRate(incomeTax[1], rate) - getSumByRate(incomeTax[0], rate)],
                ['  Пенсионный  I:', pensionTax[0], true],
                ['  Пенсионный II:', pensionTax[1], true],
                ['  Разница:', getSumByRate(pensionTax[1], rate) - getSumByRate(pensionTax[0], rate)],
                ['  Профсоюзный  I:', tradeUnionTax[0], true],
                ['  Профсоюзный II:', tradeUnionTax[1], true],
                ['  Разница:', getSumByRate(tradeUnionTax[1], rate) - getSumByRate(tradeUnionTax[0], rate)],
                [allTaxes[0] || allTaxes[1] ? '=' : ''],
                [`Информация на ${date2str(de)}:`],
                ['Подразделение:'],
                [this.getPaySlipString('', deptName[0])],
                ['Должность:'],
                [this.getPaySlipString('', posName[0])],
                ['='],
                [`Информация на ${date2str(toDe)}:`],
                ['Подразделение:'],
                [this.getPaySlipString('', deptName[1])],
                ['Должность:'],
                [this.getPaySlipString('', posName[1])],
                ['='],
                [`Оклад на ${date2str(de)}:`, salary[0], true],
                [`Оклад на ${date2str(toDe)}:`, salary[1], true],
                ['Разница:', getSumByRate(salary[1], rate) - getSumByRate(salary[0], rate)],
                [`ЧТС на ${date2str(de)}:`, hourrate[0], true],
                [`ЧТС на ${date2str(toDe)}:`, hourrate[1], true],
                ['Разница:', getSumByRate(hourrate[1], rate) - getSumByRate(hourrate[0], rate)]
              ]
              break;
            }
          }
        }
        if (currencyId && currencyId !== '0') {
          template = [...template, [`Курс на ${date2str(db)}:`, rate]]
        }
        return this.paySlipView(template)
      } else {
        return ''
      }
    }
    return ''
  }

  /**
   * Обработка поступившего текста или команды из чата.
   * @param chatId
   * @param message
   */
  process(chatId: string, message: string, fromId?: string, fromUserName?: string) {
    //console.log(`Из чата ${chatId} нам пришел такой текст: ${message}`)

    const dialogState = this._dialogStates.read(chatId);

    if (message === 'login' || message === 'logout' || message === 'settings' || message === 'getCurrency' || message === 'paySlip'
      || message === 'detailPaySlip' || message === 'concisePaySlip' || message === 'comparePaySlip' || message === 'menu' || message === 'http://gsbelarus.com') {
      return
    }

    if (dialogState?.type === 'LOGGING_IN') {
      this.loginDialog(chatId, message);
    } else if (dialogState?.type === 'INITIAL') {
      this.sendMessage(chatId,
        'Для получения информации о заработной плате необходимо зарегистрироваться в системе.',
        keyboardLogin);
    } else if (dialogState?.type !== 'GETTING_CURRENCY' && dialogState?.type !== 'GETTING_CONCISE' && dialogState?.type !== 'GETTING_COMPARE')  {
      this.sendMessage(chatId,
        `
  🤔 Ваша команда непонятна.

Выберите одно из предложенных действий.
  `, keyboardMenu);
    }
  }

  callback_query(chatId: string, lng: Lang, queryData: string) {
    const dialogState = this._dialogStates.read(chatId);

    if (dialogState?.type === 'GETTING_CONCISE') {
      this.paySlipDialog(chatId, lng, queryData);
    } else if (dialogState?.type === 'GETTING_COMPARE') {
      this.paySlipCompareDialog(chatId, lng, queryData);
    } else if (dialogState?.type === 'GETTING_CURRENCY') {
      this.currencyDialog(chatId, lng, queryData);
    }
  }

  /**
   * Вызывается при запуске чат бота клиентом.
   * @param chatId
   */
  start(chatId: string, startMessage: string) {
    const link = this.accountLink.read(chatId);

    console.log('start');

    if (!link) {
      this.dialogStates.merge(chatId, { type: 'INITIAL', lastUpdated: new Date().getTime() });
      this.sendMessage(chatId, startMessage, keyboardLogin);
    } else {
      this.dialogStates.merge(chatId, { type: 'LOGGED_IN', lastUpdated: new Date().getTime() });
      this.sendMessage(chatId,
        `Здравствуйте! Вы зарегистрированы в системе.\nВыберите одно из предложенных действий.`,
        keyboardMenu);
    }
  }

  unsubscribe(chatId: string) {
    this.dialogStates.delete(chatId);
    this.accountLink.delete(chatId);
  }

  menu(chatId: string) {
    const dialogState = this._dialogStates.read(chatId);
    if (dialogState?.type === 'GETTING_COMPARE' || dialogState?.type === 'GETTING_SETTINGS' || dialogState?.type === 'GETTING_CURRENCY' || dialogState?.type === 'GETTING_CONCISE') {
      this.deleteMessage(chatId);
    }
    this.dialogStates.merge(chatId, { type: 'LOGGED_IN', lastUpdated: new Date().getTime() });
    this.sendMessage(chatId, 'Выберите одно из предложенных действий.', keyboardMenu);
  }

  settings(chatId: string) {
    this._dialogStates.merge(chatId, { type: 'GETTING_SETTINGS', lastUpdated: new Date().getTime() });
    this.sendMessage(chatId, 'Выберите необходимый пункт из параметров.', keyboardSettings);
  }

  async logout(chatId: string) {
    this.dialogStates.merge(chatId, { type: 'INITIAL', lastUpdated: new Date().getTime() }, ['employee']);
    await this.sendMessage(chatId, '💔 До свидания!', keyboardLogin);
    this.accountLink.delete(chatId);
  }

  async paySlip(chatId: string, typePaySlip: TypePaySlip, lng: Lang, db: Date, de: Date) {
    let dBegin = db;
    let dEnd = de;
    while (true) {
      const cListok = await this.getPaySlip(chatId, typePaySlip, lng, dBegin, dEnd);
      if (cListok) {
        await this.sendMessage(chatId, cListok, keyboardMenu, true);
        return;
      }

      dEnd.setMonth(dBegin.getMonth());
      dEnd.setDate(0);
      dBegin.setMonth(dBegin.getMonth() - 1);

      if (dBegin.getTime() < MINDATE.getTime()) {
        await this.sendMessage(chatId,
          `Нет данных для расчетного листка 🤔`,
          keyboardMenu);
        return;
      }
    }
  }

  /**
   * Вызов справки.
   * @param chatId
   * @param state
   */
  help(chatId: string, state: DialogState) {
    this.sendMessage(chatId, 'Help message')
  }

  finalize() {
    this.accountLink.flush();
    this.dialogStates.flush();
  }
};