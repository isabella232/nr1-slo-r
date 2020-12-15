import { NerdGraphMutation, NerdGraphQuery } from 'nr1';
import { getErrorBudgetNRQL } from '../queries/error-budget-slo/single-document';

export const getAlertPolicies = async () => {
  let cursor = null;
  let allPolicies = [];

  do {
    const searchMethod = cursor
      ? `policiesSearch(cursor: "${cursor}") {`
      : 'policiesSearch {';
    const policiesQuery = `{
        actor {
          account(id: 1092591) {
            alerts {
              ${searchMethod}
                nextCursor
                policies {
                  name
                  id
                }
              }
            }
          }
        }
      }`;

    const results = await NerdGraphQuery.query({
      query: policiesQuery
    });

    const policies = results.data.actor.account.alerts.policiesSearch.policies;
    if (policies && policies.length > 0) {
      allPolicies = allPolicies.concat(policies);

      cursor = results.data.actor.account.alerts.policiesSearch.nextCursor;
    }
  } while (cursor);
  return allPolicies;
};

const createAlertCondition = async function(slo) {
  const mutation = `mutation {
      alertsNrqlConditionStaticCreate(
          accountId: ${slo.accountId},
          policyId: ${slo.alertPolicy},
          condition: {
              enabled: false,
              name: "${slo.name} - SLO",
              nrql: {
                  query: "${getErrorBudgetNRQL(
                    slo.transactions,
                    slo.defects,
                    slo.appName,
                    slo.language
                  )}"
              },
              terms: {
                  operator: BELOW,
                  threshold: ${slo.target},
                  thresholdOccurrences: AT_LEAST_ONCE,
                  thresholdDuration: 120,
                  priority: CRITICAL
              },
              valueFunction: SINGLE_VALUE,
              signal: {
                  aggregationWindow: 900,
                  evaluationOffset: 1
              }
          }
      ) {
          id
      }
  }`;

  const result = await NerdGraphMutation.mutate({ mutation: mutation });

  if (!result) {
    // eslint-disable-next-line no-console
    console.error(`Problem creating alert condition for slo ${slo.id}`);
  } else {
    return result.data.alertsNrqlConditionStaticCreate.id;
  }
};

const deleteAlertCondition = async function(slo) {
  const mutation = `mutation {
      alertsConditionDelete(accountId: ${slo.accountId}, id: ${slo.alertCondition}) {
          id
      }
  }`;

  const result = await NerdGraphMutation.mutate({ mutation: mutation });

  if (!result) {
    // eslint-disable-next-line no-console
    console.error(
      `Problem deleting alert condition ${slo.alertCondition} for slo ${slo.name}:${slo.id}`
    );
  } else {
    return true;
  }
};

export default { createAlertCondition, deleteAlertCondition };
