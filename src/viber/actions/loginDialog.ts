import { dialogStates, customers, employeesByCustomer, accountLink } from "../../server";
import { normalizeStr } from "../../util/utils";
import { IDialogStateLoggingIn, IEmployee } from "../../types";
import { FileDB } from "../../util/fileDB";
import { keyboardLogin, keyboardMenu } from "../../telegram/util/keybord";
import path from 'path';
import { withMenu } from "../viber";
const TextMessage = require('viber-bot').Message.Text;
const KeyboardMessage = require('viber-bot').Message.Keyboard;


export const loginDialog = async (bot: any, response: any, message: any, start = false) => {

  // if (!ctx.chat) {
  //   throw new Error('Invalid context');
  // }

  const chatId = response.userProfile.id.toString();

  if (start) {
    await withMenu(bot, response, [
      TextMessage('Для регистрации в системе введите указанные данные.')])
    dialogStates.merge(chatId, { type: 'LOGGING_IN', lastUpdated: new Date().getTime(), employee: {} });
  }

  const dialogState = dialogStates.getMutable(true)[chatId];

  if (!dialogState || dialogState.type !== 'LOGGING_IN') {
    throw new Error('Invalid dialog state');
  }

  const text = start ? '' : normalizeStr(message);
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
       // await withMenu(ctx, '😕 Такого предприятия нет в базе данных!', keyboardLogin);
        await withMenu(bot, response, [
          TextMessage('😕 Такого предприятия нет в базе данных!'),
          KeyboardMessage([keyboardLogin])
        ]);
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
      //withMenu(ctx, '🏁 Регистрация прошла успешно.', keyboardMenu);
      await withMenu(bot, response, [
        TextMessage('🏁 Регистрация прошла успешно.'),
        KeyboardMessage([keyboardMenu])
      ]);
    } else {
      await withMenu(bot, response, [
        TextMessage(
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
`),
        KeyboardMessage([keyboardLogin])
      ]);

      dialogStates.merge(chatId, { type: 'INITIAL', lastUpdated: new Date().getTime() }, ['employee']);
    }
  } else {
    if (!employee.customerId) {
      await withMenu(bot, response, [TextMessage('Введите название предприятия:')]);
      //withMenu(ctx, 'Введите название предприятия:');
    }
    else if (!employee.firstName) {
      await withMenu(bot, response, [TextMessage('Введите имя:')]);
      //withMenu(ctx, 'Введите имя:');
    }
    else if (!employee.lastName) {
      await withMenu(bot, response, [TextMessage('Введите фамилию:')]);
     // withMenu(ctx, 'Введите фамилию:');
    }
    else if (!employee.patrName) {
      await withMenu(bot, response, [TextMessage('Введите отчество:')]);
      //withMenu(ctx, 'Введите отчество:');
    }
    else if (!employee.passportId) {
      await withMenu(bot, response, [TextMessage('Введите идентификационный номер из паспорта:')]);
      //withMenu(ctx, 'Введите идентификационный номер из паспорта:');
    }
    else if (!employee.tabNumber) {
      await withMenu(bot, response, [TextMessage('Введите табельный номер из расчетного листка:')]);
      //withMenu(ctx, 'Введите табельный номер из расчетного листка:');
    }
  }
};