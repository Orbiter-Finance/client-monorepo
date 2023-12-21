import { Injectable } from '@nestjs/common';
import {
  OrbiterLogger,
  LoggerDecorator,
  equals,
  getObjKeyByValue
} from '@orbiter-finance/utils';
import { BridgeTransactionAttributes, Transfers as TransfersModel, TransferOpStatus, DeployRecord } from '@orbiter-finance/seq-models';
import { validateAndParseAddress } from 'starknet'
import { ChainConfigService, ENVConfigService, IChainConfig, MakerV1RuleService, Token } from '@orbiter-finance/config';
import BigNumber from 'bignumber.js';
import { v1MakerUtils} from '@orbiter-finance/utils'
import dayjs from 'dayjs';
import { hexlify } from 'ethers6';
import { TransactionID, ValidSourceTxError, addressPadStart, decodeV1SwapData } from '../utils';
import RLP from "rlp";
export function parseSourceTxSecurityCode(value: string) {
  let index = 0;
  for (let i = value.length - 1; i > 0; i--) {
    if (+value[i] !== 0) {
      index = i;
      break;
    }
  }
  let code = String(+value.substr(index - 3, 4));
  if (code.length !== 4) {
    for (let i = 0; i < 4 - code.length; i++) {
      code += '0';
    }
  } else if ((/^[1-9]90[1-9]$/.test(code))) {
    // To fit values like this 0.026786488299999030
    code = code.slice(1) + '0'
  }
  const nCode = Number(code);
  if (nCode < 9000 || nCode > 10000) {
    return 0;
  }
  return nCode % 1000;
}
export function parseTragetTxSecurityCode(value: string):string {
  return (+value.substring(value.length - 4)).toString();
}

export function parseZksyncLiteSourceTxSecurityCode(value: string) {
  const stringValue = new BigNumber(value).toString()
  let code = stringValue.slice(stringValue.length - 4)
  code = code.slice(code.indexOf('9'))
  if (code.length !== 4) {
    for (let i = 0; i < 4 - code.length; i++) {
      code += '0';
    }
  }
  const nCode = Number(code);
  if (nCode < 9000 || nCode > 10000) {
    return 0;
  }
  return nCode % 1000;
}


export type BuilderData = {
  targetToken: Token
  targetChain: IChainConfig
  targetAddress: string
  targetAmount: string
}


@Injectable()
export class InscriptionStandardBuilder {
  @LoggerDecorator()
  private readonly logger: OrbiterLogger;
  constructor(
    protected chainConfigService: ChainConfigService,
    protected envConfigService: ENVConfigService,
    protected makerV1RuleService: MakerV1RuleService,
  ) {

  }
  async build(transfer: TransfersModel): Promise<BuilderData> {
    const result = {} as BuilderData
    const targetChainId = parseSourceTxSecurityCode(transfer.amount);
    const targetChain = this.chainConfigService.getChainByKeyValue(
      'internalId',
      targetChainId,
    );
    if (!targetChain) {
      return result
    }
    result.targetChain = targetChain
    //
    const targetToken = this.chainConfigService.getTokenBySymbol(
      targetChain.chainId,
      transfer.symbol,
    );
    if (!targetToken) {
      return result
    }
    const callData = transfer.calldata as any
    const { amt } = callData
    result.targetAmount = amt;
    result.targetToken = targetToken
    result.targetAddress = transfer.sender;
    return result
  }
}


@Injectable()
export default class InscriptionBuilder {
  @LoggerDecorator()
  private readonly logger: OrbiterLogger;
  constructor(
    protected chainConfigService: ChainConfigService,
    protected makerV1RuleService: MakerV1RuleService,
    protected envConfigService: ENVConfigService,
    private standardBuilder: InscriptionStandardBuilder,
  ) { }
  async build(transfer: TransfersModel, deployRecord: DeployRecord): Promise<BridgeTransactionAttributes> {
    // build other common
    const createdData: BridgeTransactionAttributes = {
      sourceId: transfer.hash,
      sourceAddress: transfer.sender,
      sourceMaker: transfer.receiver,
      sourceAmount: transfer.amount.toString(),
      sourceChain: transfer.chainId,
      sourceNonce: transfer.nonce,
      sourceSymbol: transfer.symbol,
      sourceToken: transfer.token,
      targetToken: null,
      sourceTime: transfer.timestamp,
      dealerAddress: null,
      ebcAddress: null,
      targetChain: null,
      ruleId: null,
      targetAmount: null,
      targetAddress: null,
      targetSymbol: null,
      createdAt: new Date(),
      version: transfer.version,
    };
    if (+transfer.nonce >= 9000) {
      throw new ValidSourceTxError(TransferOpStatus.NONCE_EXCEED_MAXIMUM, `Exceeded the maximum nonce value ${transfer.nonce} / 9000`)
    }

    const sourceChain = this.chainConfigService.getChainInfo(transfer.chainId);
    if (!sourceChain) {
      throw new ValidSourceTxError(TransferOpStatus.SOURCE_CHAIN_OR_TOKEN_NOT_FOUND, `${transfer.token} sourceChain not found`)
    }
    const builderData = await this.standardBuilder.build(transfer);
    const { targetAddress: builderDataTargetAddress, targetChain, targetToken, targetAmount } = builderData
    if (!targetChain) {
      throw new ValidSourceTxError(TransferOpStatus.TARGET_CHAIN_OR_TOKEN_NOT_FOUND, `targetChain not found`)
    }

    if (builderDataTargetAddress) {
      createdData.targetAddress = builderDataTargetAddress.toLowerCase()
    } else {
      throw new ValidSourceTxError(TransferOpStatus.RULE_NOT_FOUND, 'no targetAddress')
    }
    createdData.withholdingFee = createdData.sourceAmount;
    createdData.targetAmount = targetAmount;
    createdData.targetChain = targetChain.chainId
    createdData.targetToken = deployRecord.hash;
    createdData.targetSymbol = deployRecord.tick;
    createdData.targetMaker = transfer.receiver;
    createdData.transactionId = TransactionID(
      transfer.sender,
      sourceChain.internalId,
      transfer.nonce,
      transfer.symbol,
      dayjs(transfer.timestamp).valueOf(),
    );
    createdData.ruleId = deployRecord.protocol;
    createdData.responseMaker = [transfer.receiver];
    return createdData
  }
}