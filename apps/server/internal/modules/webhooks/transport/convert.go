package transport

import (
	"google.golang.org/protobuf/types/known/timestamppb"

	webhooksv1 "github.com/aedst/server/gen/go/aedst/webhooks/v1"
	"github.com/aedst/server/internal/modules/webhooks/api"
)

// endpointToProto maps an endpoint to its message. The message has no field
// for the signing secret, and neither does api.Endpoint.
func endpointToProto(e api.Endpoint) *webhooksv1.Endpoint {
	return &webhooksv1.Endpoint{
		Id:                  e.ID.String(),
		Url:                 e.URL,
		Description:         e.Description,
		EventTypes:          e.EventTypes,
		Status:              endpointStatusToProto(e.Status),
		DisabledReason:      disabledReasonToProto(e.DisabledReason),
		ConsecutiveFailures: int32(e.ConsecutiveFailures),
		CreatedAt:           timestamppb.New(e.CreatedAt),
		UpdatedAt:           timestamppb.New(e.UpdatedAt),
	}
}

func endpointStatusToProto(s api.EndpointStatus) webhooksv1.EndpointStatus {
	switch s {
	case api.EndpointActive:
		return webhooksv1.EndpointStatus_ENDPOINT_STATUS_ACTIVE
	case api.EndpointDisabled:
		return webhooksv1.EndpointStatus_ENDPOINT_STATUS_DISABLED
	default:
		return webhooksv1.EndpointStatus_ENDPOINT_STATUS_UNSPECIFIED
	}
}

func disabledReasonToProto(r api.DisabledReason) webhooksv1.EndpointDisabledReason {
	switch r {
	case api.DisabledByOperator:
		return webhooksv1.EndpointDisabledReason_ENDPOINT_DISABLED_REASON_OPERATOR
	case api.DisabledByFailures:
		return webhooksv1.EndpointDisabledReason_ENDPOINT_DISABLED_REASON_CONSECUTIVE_FAILURES
	default:
		return webhooksv1.EndpointDisabledReason_ENDPOINT_DISABLED_REASON_UNSPECIFIED
	}
}

func deliveryToProto(d api.Delivery) *webhooksv1.Delivery {
	out := &webhooksv1.Delivery{
		Id:             d.ID.String(),
		EndpointId:     d.EndpointID.String(),
		EventId:        d.EventID.String(),
		EventType:      d.EventType,
		Status:         deliveryStatusToProto(d.Status),
		Attempts:       int32(d.Attempts),
		LastStatusCode: int32(d.LastStatusCode),
		LastError:      d.LastError,
		CreatedAt:      timestamppb.New(d.CreatedAt),
		UpdatedAt:      timestamppb.New(d.UpdatedAt),
	}
	if d.DeliveredAt != nil {
		out.DeliveredAt = timestamppb.New(*d.DeliveredAt)
	}
	return out
}

func deliveryStatusToProto(s api.DeliveryStatus) webhooksv1.DeliveryStatus {
	switch s {
	case api.DeliveryPending:
		return webhooksv1.DeliveryStatus_DELIVERY_STATUS_PENDING
	case api.DeliveryDelivered:
		return webhooksv1.DeliveryStatus_DELIVERY_STATUS_DELIVERED
	case api.DeliveryFailed:
		return webhooksv1.DeliveryStatus_DELIVERY_STATUS_FAILED
	case api.DeliveryCancelled:
		return webhooksv1.DeliveryStatus_DELIVERY_STATUS_CANCELLED
	default:
		return webhooksv1.DeliveryStatus_DELIVERY_STATUS_UNSPECIFIED
	}
}
