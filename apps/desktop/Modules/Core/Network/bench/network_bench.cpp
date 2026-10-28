#include "aedst/contract/methods.hpp"
#include "aedst/network/connect_envelope.hpp"
#include "aedst/network/connect_error.hpp"

#include <QByteArray>
#include <QTest>

#include <algorithm>
#include <cstddef>
#include <string>

namespace {

namespace authv1 = ::aedst::auth::v1;
namespace envelope = ::aedst::network::envelope;

authv1::LoginResponse sampleResponse() {
    authv1::LoginResponse response;
    response.set_user_id("0b6c1c9e-0000-0000-0000-000000000001");
    response.mutable_tokens()->set_access_token(std::string(600, 'a')); // JWT-sized
    response.mutable_tokens()->set_refresh_token(std::string(600, 'r'));
    response.mutable_tokens()->set_access_token_expires_in_seconds(900);
    response.mutable_tokens()->set_refresh_token_expires_in_seconds(2592000);
    return response;
}

} // namespace

class NetworkBench : public QObject {
    Q_OBJECT

private slots:

    void protobufSerializeLoginResponse() {
        const authv1::LoginResponse response = sampleResponse();
        QBENCHMARK {
            consume(response.SerializeAsString().size());
        }
    }

    void protobufParseLoginResponse() {
        const std::string bytes = sampleResponse().SerializeAsString();
        QBENCHMARK {
            authv1::LoginResponse parsed;
            consume(parsed.ParseFromArray(bytes.data(), static_cast<int>(bytes.size()))
                        ? parsed.tokens().access_token().size()
                        : 0);
        }
    }

    void envelopeEncode() {
        const QByteArray payload(1200, 'p');
        QBENCHMARK {
            consume(static_cast<std::size_t>(envelope::encode(0, payload).size()));
        }
    }

    void envelopeDecodeSixteenFramesInSmallReads() {
        QByteArray stream;
        for (int i = 0; i < 16; ++i) {
            stream += envelope::encode(0, QByteArray(256, 'm'));
        }
        QBENCHMARK {
            envelope::EnvelopeReader reader;
            for (qsizetype offset = 0; offset < stream.size(); offset += 512) {
                reader.feed(QByteArrayView(stream).sliced(offset, std::min<qsizetype>(512, stream.size() - offset)));
                for (;;) {
                    auto frame = reader.next();
                    if (!frame || !*frame) {
                        break;
                    }
                    consume(static_cast<std::size_t>((*frame)->payload.size()));
                }
            }
        }
    }

    void errorBodyParse() {
        const QByteArray body = R"({"code":"unavailable","message":"upstream connect error","details":[]})";
        QBENCHMARK {
            consume(aedst::network::errorFromUnaryResponse(503, body, "").message.size());
        }
    }

private:
    void consume(std::size_t value) { sink_ = sink_ + value; }

    // Keeps the optimizer from discarding the measured work.
    volatile std::size_t sink_{0};
};

QTEST_GUILESS_MAIN(NetworkBench)
#include "network_bench.moc"
