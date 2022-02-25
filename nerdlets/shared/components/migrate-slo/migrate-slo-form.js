import React, { Component } from 'react';
import PropTypes from 'prop-types';
import {
  Button,
  Checkbox,
  HeadingText,
  Modal,
  NerdGraphMutation,
  ngql,
  Spinner,
  Stack,
  StackItem
} from 'nr1';
import { writeSloDocument } from '../../services/slo-documents';

export default class MigrateSLOForm extends Component {
  constructor(props) {
    super(props);
    this.state = {
      isProcessing: false,
      selectedSLOS: []
    };
  }

  // componentDidMount() {
  //   console.debug("c-did-m");
  // }

  // componentDidUpdate = async prevProps => {
  //   console.debug("c-did-u");
  // };

  registerSlo(event, slo) {
    const { selectedSLOS } = this.state;
    if (event.target.checked) {
      // this.state.selectedSLOS.push(slo);
      selectedSLOS.push(slo);
      this.setState({ selectedSLOS });
    } else {
      const index = this.state.selectedSLOS.findIndex(s => s.id === slo.id);

      if (index > -1) {
        // this.state.selectedSLOS.splice(index, 1);
        selectedSLOS.splice(index, 1);
        this.setState({ selectedSLOS });
      }
    }
  }

  processMigrationQueue() {
    const { selectedSLOS } = this.state;

    const res = selectedSLOS.map(slo => this.fireMigrationRequest(slo));

    console.debug(`mig: ${res.length}`); // eslint-disable-line no-console
  }

  async fireMigrationRequest(slo) {
    const httpResponseCodeKey = await this.reconcileResponseCodeKeyInconsistencies(
      slo.document.language
    );

    let transactionsNRQL = '';
    let badEventsNRQL = '';
    let mutation = null;

    // create the string to target transactions
    if (Array.isArray(slo.document.transactions)) {
      for (let t = 0; t < slo.document.transactions.length; t++) {
        if (t > 0) {
          transactionsNRQL = `${transactionsNRQL} OR`;
        }

        transactionsNRQL = `${transactionsNRQL} name LIKE '${slo.document.transactions[t]}'`;
      } // for
    } // if
    else {
      // eslint-disable-next-line no-lonely-if
      if (slo.document.transactions === 'all') {
        transactionsNRQL = 'ALL';
      } // if
    } // else

    // create the string for bad events
    for (let d = 0; d < slo.document.defects.length; d++) {
      if (d > 0) {
        badEventsNRQL = `${badEventsNRQL} OR`;
      } // if

      // determine if this defect is a duration or error
      if (slo.document.defects[d].value.includes('duration')) {
        badEventsNRQL = `${badEventsNRQL} ${slo.document.defects[d].value}`;
      } // if
      else if (slo.document.defects[d].value.includes('apdex_frustrated')) {
        badEventsNRQL = `${badEventsNRQL} apdexPerfZone = 'F'`;
      } // else if
      else {
        // assuming http response code
        badEventsNRQL = `${badEventsNRQL} ${httpResponseCodeKey} LIKE '${slo.document.defects[d].value}'`;
      } // else
    } // for

    // create the mutation
    if (transactionsNRQL === 'ALL') {
      mutation = `serviceLevelCreate(
              entityGuid: "${slo.document.entityGuid}", 
              indicator: {
                  description: "${slo.document.description}", 
                  events: {
                      accountId: ${slo.document.accountId}, 
                      badEvents: {from: "Transaction", where: "${badEventsNRQL}"}, 
                      validEvents: {from: "Transaction"}
                  }, 
                  name: "${slo.document.name} (SLO/R Migration)", 
                  objectives: [
                      {
                          description: "1 day slo/r window", 
                          name: "slo/r_target_1d", 
                          target: ${slo.document.target}, 
                          timeWindow: {
                              rolling: {
                                  count: 1, 
                                  unit: DAY}
                              }
                      },
                      {
                          description: "7 day slo/r window", 
                          name: "slo/r_target_7d", 
                          target: ${slo.document.target}, 
                          timeWindow: {
                              rolling: {
                                  count: 7, 
                                  unit: DAY}
                              }
                      },
                      {
                          description: "28 day slo/r window", 
                          name: "slo/r_target_28d", 
                          target: ${slo.document.target}, 
                          timeWindow: {
                              rolling: {
                                  count: 28, 
                                  unit: DAY}
                              }
                      }
                  ]
              }
          ) {
            createdAt
            createdBy {
              email
            }
            id
            name
          }`;
    } // if
    else {
      mutation = `serviceLevelCreate(
              entityGuid: "${slo.document.entityGuid}", 
              indicator: {
                  description: "${slo.document.description}", 
                  events: {
                      accountId: ${slo.document.accountId}, 
                      badEvents: {from: "Transaction", where: "(${badEventsNRQL}) AND (${transactionsNRQL})"}, 
                      validEvents: {from: "Transaction", where: "${transactionsNRQL}"}
                  }, 
                  name: "${slo.document.name} (SLO/R Migration)", 
                  objectives: [
                      {
                          description: "1 day slo/r window", 
                          name: "slo/r_target_1d", 
                          target: ${slo.document.target}, 
                          timeWindow: {
                              rolling: {
                                  count: 1, 
                                  unit: DAY}
                              }
                      },
                      {
                          description: "7 day slo/r window", 
                          name: "slo/r_target_7d", 
                          target: ${slo.document.target}, 
                          timeWindow: {
                              rolling: {
                                  count: 7, 
                                  unit: DAY}
                              }
                      },
                      {
                          description: "28 day slo/r window", 
                          name: "slo/r_target_28d", 
                          target: ${slo.document.target}, 
                          timeWindow: {
                              rolling: {
                                  count: 28, 
                                  unit: DAY}
                              }
                      }
                  ]
              }
          ) {
            createdAt
            createdBy {
              email
            }
            id
            name
          }`;
    } // else

    console.debug(mutation); // eslint-disable-line no-console

    const result = await NerdGraphMutation.mutate({
      mutation: ngql`
        mutation{
          ${mutation}
        }`
    });

    console.debug(`result ${result}`); // eslint-disable-line no-console

    if (result.error === null) {
      // eslint-disable-next-line require-atomic-updates
      slo.document.migrationId = result.data.serviceLevelCreate.id;
      const index = this.state.selectedSLOS.findIndex(s => s.id === slo.id);
      if (index > -1) {
        const { selectedSLOS } = this.state;
        selectedSLOS.splice(index, 1);
        this.setState({ selectedSLOS });
      }
      await writeSloDocument({
        entityGuid: slo.document.entityGuid,
        document: slo.document
      });
    } else {
      console.debug(`errs ${result.error}`); // eslint-disable-line no-console
    }
  }

  // this should be repaced with the function already in slo-r
  async reconcileResponseCodeKeyInconsistencies(_language) {
    if (_language === 'dotnet' || _language === 'python') {
      return 'response.status';
    } // if
    else {
      return 'httpResponseCode';
    } // else
  }

  getMigrationStack() {
    // const { isOpen, onClose, slos } = this.props;
    const { slos } = this.props;

    const nonMigratableIndicators = ['availability', 'capacity', 'latency'];
    const inArray = (key, items) => {
      return items.find(item => item === key);
    };

    return (
      <>
        {slos.map(slo => (
          // eslint-disable-next-line react/jsx-key
          <StackItem>
            <Checkbox
              key={slo.document.documentId}
              onChange={event => this.registerSlo(event, slo)}
              label={`${slo.document.name} :: ${slo.document.appName}${
                /* eslint-disable no-nested-ternary, prettier/prettier */
                slo.document.migrationId
                  ? ` :: Migration Id: ${slo.document.migrationId}`
                  : inArray(slo.document.indicator, nonMigratableIndicators)
                    ? ':: Not Migratable'
                    : ''
                /* eslint-enable no-nested-ternary, prettier/prettier */
              }`}
              checked={
                this.state.selectedSLOS.findIndex(s => s.id === slo.id) > -1
              }
              disabled={
                slo.document.migrationId !== null ||
                inArray(slo.document.indicator, nonMigratableIndicators)
              }
            />
          </StackItem>
        ))}
      </>
    );
  }

  render() {
    const { isOpen, onClose, slos } = this.props;
    const { isProcessing } = this.state;

    // if (Array.isArray(slos)) {
    //   slos.forEach(slo => {
    //     console.debug(`--> ${JSON.stringify(slo)}`); // eslint-disable-line no-console
    //   });
    // } // if

    return (
      <Modal hidden={!isOpen} onClose={onClose}>
        <HeadingText type={HeadingText.TYPE.HEADING_2}>
          Select SLOs to migrate
          {isProcessing && <Spinner inline />}
        </HeadingText>
        <Stack directionType={Stack.DIRECTION_TYPE.VERTICAL}>
          {this.getMigrationStack(slos)}
          <StackItem>
            <Button
              onClick={() => this.processMigrationQueue()}
              type={Button.TYPE.PRIMARY}
              iconType={
                Button.ICON_TYPE.HARDWARE_AND_SOFTWARE__SOFTWARE__DESTINATIONS
              }
              disabled={this.state.selectedSLOS.length === 0}
            >
              Migrate
            </Button>
          </StackItem>
        </Stack>
      </Modal>
    );
  }
}

MigrateSLOForm.propTypes = {
  slos: PropTypes.array.isRequired,
  isOpen: PropTypes.bool,
  onClose: PropTypes.func.isRequired
};
